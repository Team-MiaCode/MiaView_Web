import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {staticServer} from "../scripts/serve.mjs";
import {waitForAsync} from "./helpers/wait-async.mjs";
import {listenForBrowser} from "./helpers/browser-server.mjs";
import {observeVideoDecoders,decoderSnapshot} from "./helpers/video-decoder-probe.mjs";

const browsers=await import(process.env.MIACODE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href:"playwright");
const format=process.env.MIACODE_EXPORT_FORMAT||"auto";
const software=process.env.MIACODE_SOFTWARE_VIDEO==="1";
const output=resolve(`artifacts/video-export-core/${process.env.MIACODE_BROWSER||"chromium"}-${format}${software?"-software":""}`);mkdirSync(output,{recursive:true});
const server=staticServer(process.cwd(),{performanceTerminal:false});await listenForBrowser(server);
const browser=await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER||"chromium");
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:960,height:720}});page.setDefaultTimeout(120000);
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await observeVideoDecoders(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);
  await page.evaluate(async software=>{
    const {createPreview}=await import("/sdk/index.mjs");
    window.preview=createPreview(document.getElementById("one"),{resolution:{width:320,height:180}});
    window.exports=new Map();window.exportProgress=[];
    preview.on("exportCompleted",event=>exports.set(event.jobId,event));
    preview.on("exportFailed",event=>exports.set(event.jobId,event));
    preview.on("exportProgress",event=>exportProgress.push(event));
    await preview.ready;
    await preview.setPerformance({videoDecodePrefersSoftware:software});
    const wave=new ArrayBuffer(44+24000*4*2),view=new DataView(wave);
    const text=(offset,value)=>[...value].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
    text(0,"RIFF");view.setUint32(4,wave.byteLength-8,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,wave.byteLength-44,true);
    for(let index=0;index<24000*4;index++)view.setInt16(44+index*2,Math.round(Math.sin(index/24000*Math.PI*880)*4000),true);
    await preview.load({maidata:"&title=Export Test\n&artist=Test\n&lv_5=12\n&inote_5=(120){4}1,2,3,4,E",audio:new Blob([wave],{type:"audio/wav"}),cover:"/ui/components/icons/app.png",difficulty:5});
    await preview.seek(.3);
    await preview.setSettings({showTimestamp:false,showChartInfoHud:false,showObjectStatsHud:false});
  },software);
  const capabilities=await page.evaluate(format=>preview.getExportCapabilities({width:320,height:180,fps:30,format}),format);
  console.log(JSON.stringify({capabilities}));
  console.log(JSON.stringify(await page.evaluate(async()=>{const media=await import("/renderer/vendor/mediabunny/index.mjs");return{videoCodecs:await media.getEncodableVideoCodecs(["avc","vp8","vp9"]),audioCodecs:await media.getEncodableAudioCodecs(["aac","opus"])};})));
  const job=await page.evaluate(format=>preview.startExport({width:320,height:180,fps:30,exportStartSeconds:.5,exportEndSeconds:1,format}),capabilities.format);
  await waitForAsync(page,id=>exports.has(id),job.jobId,{timeout:180000,polling:1000});
  const result=await page.evaluate(async id=>{
    const result=exports.get(id);if(!result.blob)throw new Error(result.message);
    const media=await import("/renderer/vendor/mediabunny/index.mjs");
    const input=new media.Input({source:new media.BlobSource(result.blob),formats:media.ALL_FORMATS});
    try {
      const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();
      let frameCount=0,colors=new Set();
      const canvas=document.createElement("canvas");canvas.width=320;canvas.height=180;const context=canvas.getContext("2d");
      for await(const sample of new media.VideoSampleSink(video).samples()) {
        sample.draw(context,0,0);sample.close();frameCount++;
        if(frameCount===5||frameCount===50){
          const data=context.getImageData(0,0,320,180).data;
          for(let index=0;index<data.length;index+=16)colors.add(`${data[index]},${data[index+1]},${data[index+2]}`);
        }
      }
      let silentEnergy=0,audibleEnergy=0,silentCount=0,audibleCount=0;
      for await(const item of new media.AudioBufferSink(audio).buffers()){
        const data=item.buffer.getChannelData(0);
        for(let index=0;index<data.length;index++){
          const second=item.timestamp+index/item.buffer.sampleRate;
          if(second>.2&&second<1.3){silentEnergy+=data[index]**2;silentCount++;}
          if(second>1.6&&second<1.9){audibleEnergy+=data[index]**2;audibleCount++;}
        }
      }
      const{blob,...metadata}=result;
      return {...metadata,byteSize:blob.size,decodedFrames:frameCount,colors:colors.size,duration:await input.computeDuration(),
        silentRms:Math.sqrt(silentEnergy/silentCount),audibleRms:Math.sqrt(audibleEnergy/audibleCount),restored:await preview.getState()};
    } finally {input.dispose();}
  },job.jobId);
  assert.equal(result.decodedFrames,60);assert.equal(result.frameCount,60);assert.ok(Math.abs(result.duration-2)<.06);
  assert.ok(result.colors>40,`Frame colors: ${result.colors}`);
  assert.ok(result.silentRms<.002,`Preload RMS: ${result.silentRms}`);assert.ok(result.audibleRms>.01,`Music RMS: ${result.audibleRms}`);
  assert.equal(result.restored.resolution.width,320);assert.ok(Math.abs(result.restored.currentTime-.3)<.001);
  assert.equal(result.restored.settings.showTimestamp,false);assert.equal(result.restored.settings.showChartInfoHud,false);assert.equal(result.restored.settings.showObjectStatsHud,false);
  const cancelled=await page.evaluate(async format=>{
    const directory=await navigator.storage.getDirectory(),handle=await directory.getFileHandle("cancel.webm",{create:true});
    const writer=await handle.createWritable();await writer.write("original file");await writer.close();
    window.exportFile=handle;
    const job=await preview.startExport({width:320,height:180,fps:30,fileHandle:handle,format});return job;
  },capabilities.format);
  await waitForAsync(page,id=>exportProgress.some(event=>event.jobId===id),cancelled.jobId,{timeout:120000,polling:1000});
  await page.evaluate(()=>preview.cancelExport());
  const cancellation=await page.evaluate(async id=>({event:exports.get(id),text:await(await exportFile.getFile()).text(),status:await preview.getExportStatus()}),cancelled.jobId);
  assert.equal(cancellation.event.cancelled,true);assert.equal(cancellation.text,"original file");assert.equal(cancellation.status.running,false);
  const intros=[];
  for(const pv of [false,true]) {
    if(pv)await page.evaluate(()=>preview.setResources({video:"/tests/fixtures/bg-pattern.webm"}));
    const job=await page.evaluate(({pv,format})=>preview.startExport({width:320,height:180,fps:30,format,introEnabled:true,introPvPreview:pv,introPvStartSeconds:.2}),{pv,format:capabilities.format});
    await waitForAsync(page,id=>exports.has(id),job.jobId,{timeout:180000,polling:1000});
    const intro=await page.evaluate(async id=>{
      const result=exports.get(id);if(!result.blob)throw new Error(result.message);
      const media=await import("/renderer/vendor/mediabunny/index.mjs");
      const input=new media.Input({source:new media.BlobSource(result.blob),formats:media.ALL_FORMATS});
      try {
        const track=await input.getPrimaryVideoTrack(),sink=new media.VideoSampleSink(track);
        let frames=0;for await(const sample of sink.samples()){sample.close();frames++;}
        const sample=await sink.getSample(2),canvas=document.createElement("canvas");canvas.width=320;canvas.height=180;
        const context=canvas.getContext("2d");sample.draw(context,0,0);sample.close();
        const data=context.getImageData(0,0,320,180).data;let bright=0;
        for(let index=0;index<data.length;index+=4)if(data[index]+data[index+1]+data[index+2]>120)bright++;
        const encoded=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(result.blob);});
        return {frames,duration:await input.computeDuration(),declaredFrames:result.frameCount,bright,screenshot:canvas.toDataURL(),encoded};
      } finally {input.dispose();}
    },job.jobId);
    assert.equal(intro.frames,intro.declaredFrames);assert.ok(intro.bright>1000,`Intro pixels: ${intro.bright}`);
    const expected=pv?452:355;
    console.log(JSON.stringify({intro:pv?"pv":"classic",expected,frames:intro.frames,declaredFrames:intro.declaredFrames,sourceDuration:(await page.evaluate(()=>preview.getState())).duration}));
    assert.equal(intro.frames,expected);
    writeFileSync(join(output,`intro-${pv?"pv":"classic"}.png`),Buffer.from(intro.screenshot.split(",")[1],"base64"));
    writeFileSync(join(output,`intro-${pv?"pv":"classic"}${capabilities.extension}`),Buffer.from(intro.encoded.split(",")[1],"base64"));
    delete intro.screenshot;delete intro.encoded;intros.push({pv,...intro});
  }
  await page.evaluate(()=>preview.setCoverComposition({outputWidth:320,outputHeight:180,trackOverrides:{title:"Cover restore"}}));
  const viewport=page.frameLocator("iframe").locator("#viewport");
  const coverBefore=await viewport.screenshot();
  const coverJob=await page.evaluate(format=>preview.startExport({width:320,height:180,fps:30,exportStartSeconds:.5,exportEndSeconds:1,format}),capabilities.format);
  await waitForAsync(page,id=>exports.has(id),coverJob.jobId,{timeout:120000,polling:1000});
  assert.equal(await page.evaluate(id=>Boolean(exports.get(id)?.blob),coverJob.jobId),true);
  const coverAfter=await viewport.screenshot();assert.deepEqual(coverAfter,coverBefore);
  const decoderProbe=await page.frames().find(frame=>frame.url().includes("/renderer/index.html")).evaluate(decoderSnapshot);
  if(software){assert.ok(decoderProbe.configurations.length>0);assert.ok(decoderProbe.configurations.every(value=>value==="prefer-software"));}
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,"results.json"),JSON.stringify({capabilities,result,cancellation,intros,coverRestored:true,decoderProbe,errors},null,2));
  await page.screenshot({path:join(output,"restored-preview.png")});
  console.log("Video export frames, partial-range audio, restored preview and atomic cancellation passed");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
