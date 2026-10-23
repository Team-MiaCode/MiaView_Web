import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {staticServer} from "../scripts/serve.mjs";
import {listenForBrowser} from "./helpers/browser-server.mjs";
import {waitForAsync} from "./helpers/wait-async.mjs";
import {launchPreviewBrowser} from "./preview-browser.mjs";

const browsers=await import(process.env.MIACODE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href:"playwright");
const output=resolve("artifacts/video-export-workbench");mkdirSync(output,{recursive:true});
const server=staticServer(process.cwd(),{performanceTerminal:false});await listenForBrowser(server);
const browser=await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER || "chromium");
try {
  const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});page.setDefaultTimeout(120000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(()=>{
    Object.defineProperty(window,"showSaveFilePicker",{value:undefined});Object.defineProperty(window,"showDirectoryPicker",{value:undefined});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.locator(".welcome-title").waitFor();
  await page.evaluate(()=>document.getElementById("workbench").editor.ready);
  const command=(id,args)=>page.evaluate(({id,args})=>document.getElementById("workbench").editor.command(id,args),{id,args});
  await command("file.demo");await command("page.export");
  assert.equal(await page.getByRole("button",{name:"批量导出",exact:true}).count(),0);
  assert.equal(await page.getByRole("tab",{name:"批量",exact:true}).count(),0);
  await command("export.settings",{resolutionIndex:0,fps:30,exportStartSeconds:.5,exportEndSeconds:.7,outputPath:"snapshot.mp4"});
  const download=page.waitForEvent("download");void download.catch(()=>{});
  await page.evaluate(()=>{window.exportPromise=document.getElementById("workbench").editor.command("export.video");void exportPromise.catch(error=>console.error(error));});
  await page.waitForFunction(()=>document.getElementById("workbench").editor.workbench.documentSession.exportRunning===true);
  const progressBefore=await page.locator("#export-progress").count();assert.equal(progressBefore,1);
  await command("document.metadataTitle",{value:"Edited during export"});
  const current=await page.evaluate(()=>document.getElementById("workbench").editor.preview.getDocument());assert.equal(current.title,"Edited during export");
  const result=await page.evaluate(()=>window.exportPromise);
  const file=await download;await file.saveAs(join(output,file.suggestedFilename()));
  assert.equal(result.filename,file.suggestedFilename());assert.equal(result.frameCount,51);assert.equal(result.difficulty,5);
  assert.ok(readFileSync(join(output,file.suggestedFilename())).length>1000);
  assert.equal(await page.locator(".export-render-host").count(),0);
  assert.match(await page.locator("#export-result").textContent(),/导出完成/);
  await waitForAsync(page,async()=>!(await document.getElementById("workbench").editor.preview.getState()).playing);
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,"results.json"),JSON.stringify({result,errors},null,2));
  await page.screenshot({path:join(output,"export-results.png")});
  console.log("Workbench single video export, concurrent editing and Blob delivery passed");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
