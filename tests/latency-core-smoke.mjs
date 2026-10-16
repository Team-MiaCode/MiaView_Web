import { launchPreviewBrowser } from "./preview-browser.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/latency-core"); mkdirSync(output, { recursive: true });
function pulseTrack(seconds, bpm, first) {
  const rate = 24000, count = rate * seconds, wave = Buffer.alloc(44 + count * 2);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length-8,4); wave.write("WAVEfmt ",8);
  wave.writeUInt32LE(16,16); wave.writeUInt16LE(1,20); wave.writeUInt16LE(1,22);
  wave.writeUInt32LE(rate,24); wave.writeUInt32LE(rate*2,28); wave.writeUInt16LE(2,32); wave.writeUInt16LE(16,34);
  wave.write("data",36); wave.writeUInt32LE(count*2,40);
  for (let beat = 0; first + beat*60/bpm < seconds; beat++) {
    const start = Math.round((first+beat*60/bpm)*rate), gain = [1,.45,.3,.2][beat%4];
    for (let index=0; index<480 && start+index<count; index++) wave.writeInt16LE(Math.round(Math.sin(index/rate*2*Math.PI*1000)*Math.exp(-index/100)*gain*25000),44+(start+index)*2);
  }
  return wave;
}
writeFileSync(join(output,"pulse.wav"),pulseTrack(24,120,.125));
writeFileSync(join(output,"long.wav"),pulseTrack(180,150,.25));
const reference = JSON.parse(readFileSync("tests/fixtures/latency-reference.json", "utf8"));
for (const [name, expected] of Object.entries(reference.cases))
  assert.equal(createHash("sha256").update(readFileSync(join(output, name))).digest("hex"), expected.sha256);
const compareReference = (name, bpm, offset) => {
  const expected = reference.cases[name];
  assert.ok(Math.abs(bpm.bpm-expected.bpm)<1e-8);
  assert.equal(bpm.meterId, expected.meterId);
  assert.ok(Math.abs(offset.offsetSeconds-expected.offsetSeconds)<1e-8);
};
const server = staticServer(process.cwd(), { performanceTerminal: false });
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const browser = await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER || "chromium");
try {
  const page = await browser.newPage({ viewport:{width:1366,height:900} });
  page.setDefaultTimeout(30000);
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(() => {
    const start=AudioBufferSourceNode.prototype.start;
    window.sourceStarts=[];
    AudioBufferSourceNode.prototype.start=function(...args) { sourceStarts.push({kind:this.kind,args}); return start.apply(this,args); };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.locator('.welcome-title').waitFor();
  const command=(id,args)=>page.evaluate(({id,args})=>document.getElementById('workbench').editor.command(id,args),{id,args});
  await page.evaluate(async () => {
    const editor=document.getElementById('workbench').editor; await editor.ready;
    const audio=await(await fetch('./artifacts/latency-core/pulse.wav')).blob();
    await editor.load({maidata:'&title=节拍检测\n&first=0\n&inote_5=(120){4}1,2,E\n',audio});
  });
  const documentState=()=>page.evaluate(()=>document.getElementById('workbench').editor.preview.getDocument());
  const state=()=>page.evaluate(()=>document.getElementById('workbench').editor.preview.getState());
  const original=await documentState(), normal=await state();
  await command('page.latency');
  await waitForAsync(page, async()=>(await document.getElementById('workbench').editor.preview.getState()).latency.onPage);
  assert.deepEqual(await documentState(),original);
  const audition=await state(); assert.equal(audition.duration,24); assert.ok(audition.statistics.find(item=>item.kind==='tap').total>40);
  const detected=await command('latency.detectBpm'); assert.ok(Math.abs(detected.bpm-120)<1,JSON.stringify(detected));
  const offset=await command('latency.detectOffset'); assert.ok(Math.abs(offset.offsetSeconds-.125)<.04,JSON.stringify(offset));
  compareReference("pulse.wav", detected, offset);
  await page.locator('#latencyClockCountField').fill('8'); await page.locator('#latencyClockCountField').blur();
  await page.waitForFunction(()=>document.getElementById('workbench').editor.workbench.documentSession.clockCount===8);
  const updated=await documentState(); assert.equal(updated.chartText,original.chartText); assert.equal(updated.metadataClockCount,'8');
  assert.equal(updated.first,offset.offsetSeconds.toFixed(3)); assert.equal(updated.wholeBpm,detected.bpm.toFixed(3));
  await page.locator('#latencyAuditionButton').click();
  await waitForAsync(page, async()=>(await document.getElementById('workbench').editor.preview.getState()).currentTime>.1);
  const trackStarts=()=>page.frameLocator('.preview-container iframe').locator('#qt-screen').evaluate(()=>sourceStarts.filter(item=>item.kind==='track').length);
  const starts=await trackStarts(), beforeHot=await state();
  await command('latency.bpm',{value:150}); await command('latency.offsetSeconds',{value:-.125});
  await command('latency.subdivision',{value:16}); await command('latency.sfxVolumePercent',{value:35});
  const hot=await state(); assert.equal(hot.playing,true); assert.equal(await trackStarts(),starts); assert.ok(hot.currentTime>=beforeHot.currentTime);
  assert.equal(hot.latency.subdivision,16); assert.equal(hot.latency.sfxVolumePercent,35);
  await command('page.metadata');
  await waitForAsync(page, async()=>!(await document.getElementById('workbench').editor.preview.getState()).latency.onPage);
  const restored=await state(); assert.equal(restored.playing,false);
  assert.equal(restored.statistics.find(item=>item.kind==='tap').total,normal.statistics.find(item=>item.kind==='tap').total);
  assert.deepEqual(restored.audio.settings,normal.audio.settings);
  await page.evaluate(async () => {
    const preview=document.getElementById('workbench').editor.preview;
    await preview.setResources({audio:await(await fetch('./artifacts/latency-core/long.wav')).blob()});
  });
  const long=await page.evaluate(()=>document.getElementById('workbench').editor.preview.detectLatency('bpm'));
  assert.ok(Math.abs(long.bpm-150)<1,JSON.stringify(long));
  const longOffset = await page.evaluate(bpm => document.getElementById('workbench').editor.preview.detectLatency('offset', { bpm, offsetSeconds:0 }), long.bpm);
  compareReference("long.wav", long, longOffset);
  const rejected=await page.evaluate(async()=>{
    const p=document.getElementById('workbench').editor.preview;
    const results=[];
    for(const settings of [{bpm:0},{subdivision:3},{sfxVolumePercent:101}]) {
      try {await p.setLatency(settings);results.push(false);}catch{results.push(true);}
    }
    return results;
  });
  assert.deepEqual(rejected,[true,true,true]); assert.deepEqual(errors,[]);
  writeFileSync(join(output,'results.json'),JSON.stringify({detected,offset,updated,hot,restored,long,longOffset,reference,trackStarts:starts,rejected,errors},null,2)+'\n');
  console.log('Native BPM/offset detection, document writeback, audition scene, hot clock preservation, page restore and three-minute audio passed');
} finally {await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
