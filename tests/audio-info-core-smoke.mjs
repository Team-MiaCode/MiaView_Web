import { observeFilePicker } from "./helpers/file-picker.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const browsers = await import(process.env.MIACODE_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href : "playwright");
const output = resolve("artifacts/audio-info-core"); mkdirSync(output, { recursive: true });
const synchsafe = size => Buffer.from([size >>> 21 & 127, size >>> 14 & 127, size >>> 7 & 127, size & 127]);
function frame(id, bytes, version) {
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  return Buffer.concat([Buffer.from(id), version === 4 ? synchsafe(bytes.length) : size, Buffer.alloc(2), bytes]);
}
const utf8 = text => Buffer.concat([Buffer.from([3]), Buffer.from(text)]);
const utf16 = text => Buffer.concat([Buffer.from([1,255,254]), Buffer.from(text,"utf16le")]);
const utf16be = text => Buffer.concat([Buffer.from([2]), Buffer.from(text,"utf16le").swap16()]);
const image = readFileSync("ui/components/icons/app.png");
function tag(version, frames, extended = false) {
  const extension = extended ? version === 4 ? Buffer.concat([synchsafe(6), Buffer.from([1,0])]) : Buffer.from([0,0,0,6,0,0,0,0,0,0]) : Buffer.alloc(0);
  const body = Buffer.concat([extension,...frames.map(([id,bytes])=>frame(id,bytes,version))]);
  return Buffer.concat([Buffer.from([73,68,51,version,0,extended?64:0]),synchsafe(body.length),body]);
}
const fixtures = {
  "v23.mp3": tag(3, [["TIT2",utf8("  音频标题  ")],["TPE1",utf16("歌手名")],["TALB",Buffer.from([0,...Buffer.from("Album")])],
    ["APIC",Buffer.concat([Buffer.from([0]),Buffer.from("image/png\0"),Buffer.from([3,0]),image])]],true),
  "v24.mp3": tag(4, [["TIT2",utf16be("版本四标题")],["TPE1",utf16("第二歌手")],
    ["APIC",Buffer.concat([Buffer.from([1]),Buffer.from("image/png\0"),Buffer.from([3,0,0]),image])]],true),
  "invalid-cover.mp3": tag(3, [["TIT2",utf8("封面校验")],["APIC",Buffer.concat([Buffer.from([0]),Buffer.from("image/png\0"),Buffer.from([3,0]),Buffer.from("invalid")])]]),
  "truncated.mp3": tag(4,[["TIT2",utf8("截断")]]).subarray(0,12),
  "plain.wav": Buffer.from("RIFF audio without tag"),
};
for (const [name,bytes] of Object.entries(fixtures)) writeFileSync(join(output,name),bytes);
const server = staticServer(process.cwd(),{performanceTerminal:false});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser = await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER || "chromium");
try {
  const page = await browser.newPage({viewport:{width:1366,height:900}}), errors=[];
  page.setDefaultTimeout(30000);
  page.on("pageerror",error=>errors.push(error.message));
  await observeFilePicker(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(async()=>{
    const editor=document.getElementById("workbench").editor; await editor.ready;
    await editor.load({maidata:"&title=原始标题\n&artist=原始歌手\n&inote_5=(120){4}1,2,E\n"});
  });
  const snapshot=()=>page.evaluate(()=>document.getElementById("workbench").editor.preview.getDocument());
  const original=await snapshot(), results={};
  for (const name of Object.keys(fixtures)) results[name]=await page.evaluate(async name=>{
    const audio=await(await fetch(`./artifacts/audio-info-core/${name}`)).blob();
    return document.getElementById("workbench").editor.preview.readAudioInfo(audio);
  },name);
  assert.deepEqual(await snapshot(),original);
  assert.equal(results["v23.mp3"].title,"音频标题"); assert.equal(results["v23.mp3"].artist,"歌手名");
  assert.equal(results["v23.mp3"].album,"Album"); assert.equal(results["v24.mp3"].title,"版本四标题");
  assert.equal(results["v24.mp3"].artist,"第二歌手");
  for (const name of ["v23.mp3","v24.mp3"]) {
    const cover=results[name].cover; assert.equal(cover.mimeType,"image/jpeg");
    assert.equal(Buffer.from(cover.base64,"base64").subarray(0,2).toString("hex"),"ffd8");
  }
  assert.equal(results["invalid-cover.mp3"].coverError,"内嵌封面解码失败");
  assert.equal(results["truncated.mp3"].valid,false); assert.equal(results["plain.wav"].valid,false);
  await page.evaluate(()=>document.getElementById("workbench").editor.command("page.metadata"));
  async function choose(name) {
    const picker=page.waitForEvent("filechooser");
    await page.getByRole("button",{name:"读取音频信息",exact:true}).click();
    await (await picker).setFiles(join(output,name));
  }
  await choose("v23.mp3");
  await page.waitForFunction(()=>document.getElementById("workbench").editor.workbench.documentSession.coverPath.endsWith("bg.jpg"));
  const imported=await snapshot(); assert.equal(imported.title,"音频标题"); assert.equal(imported.artist,"歌手名");
  await page.locator(".metadata-cover-view img").waitFor();
  const imageSource=await page.locator(".metadata-cover-view img").getAttribute("src");
  await choose("v24.mp3");
  await page.getByRole("button",{name:"取消",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector(".statusbar")?.textContent.includes("音频标签读取完成"));
  assert.equal((await snapshot()).title,"版本四标题"); assert.equal(await page.locator(".metadata-cover-view img").getAttribute("src"),imageSource);
  await choose("invalid-cover.mp3");
  await page.waitForFunction(()=>document.querySelector(".statusbar")?.textContent.includes("内嵌封面解码失败"));
  assert.equal((await snapshot()).title,"封面校验"); assert.equal(await page.locator(".metadata-cover-view img").getAttribute("src"),imageSource);
  const beforeInvalid=await snapshot(); await choose("truncated.mp3");
  await page.waitForFunction(()=>document.querySelector(".statusbar")?.textContent.includes("音频中未找到 ID3v2 标签"));
  assert.deepEqual(await snapshot(),beforeInvalid); assert.deepEqual(errors,[]);
  await page.screenshot({path:join(output,"metadata.png")});
  writeFileSync(join(output,"results.json"),JSON.stringify({tags:Object.fromEntries(Object.entries(results).map(([name,{cover,...info}])=>[name,{...info,coverBytes:cover?Buffer.from(cover.base64,"base64").length:0}])),imported,errors},null,2)+"\n");
  console.log("Native ID3v2.3/v2.4 encodings, extended headers, embedded JPEG conversion, metadata UI, replacement confirmation and malformed tags passed");
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
