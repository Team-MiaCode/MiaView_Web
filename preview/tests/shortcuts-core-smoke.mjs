import { launchPreviewBrowser } from "./preview-browser.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { staticServer } from "../scripts/serve.mjs";

const browsers=await import(process.env.MIACODE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href:"playwright");
const output=resolve("artifacts/shortcuts-core"); mkdirSync(output,{recursive:true});
const server=staticServer(process.cwd(),{performanceTerminal:false});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER || "chromium");
let page, checkpoint="startup";
try {
  page=await browser.newPage({viewport:{width:1366,height:900}});
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => {
    window.shortcutKeyTrace = [];
    for (const type of ["keydown", "keyup", "blur", "focus"]) window.addEventListener(type, event => {
      shortcutKeyTrace.push({ type, key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey,
        target: event.target?.tagName, at: performance.now() });
    }, true);
  });
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const command=(id,args)=>page.evaluate(({id,args})=>document.getElementById("workbench").editor.command(id,args),{id,args});
  const state=()=>page.evaluate(()=>document.getElementById("workbench").editor.preview.getState());
  async function load() {
    await page.evaluate(async()=>{
      const editor=document.getElementById("workbench").editor; await editor.ready;
      window.shortcutTrace=[]; editor.preview.on("shortcutInput",event=>shortcutTrace.push(event));
      await editor.load({maidata:"&title=快捷键\n&inote_5=(120){4}1,2,E\n"});
    });
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.locator(".welcome-title").waitFor(); await load();
  const editor=page.locator(".source-input");
  const chooseEditor=()=>page.evaluate(()=>document.getElementById("workbench").editor.viewState.openEditor("difficulty:5"));
  const text=()=>editor.inputValue();
  const selectAll=async()=>{ await chooseEditor();await editor.focus();await editor.press("Control+a"); };
  await selectAll(); await editor.press("Control+j");
  await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("8,7"));
  assert.equal(await text(),"(120){4}8,7,E");
  await editor.press("Control+z"); await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("1,2"));
  await selectAll(); await editor.press("Control+b");
  await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("1b,2b"));
  await editor.press("Control+z"); await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("1,2"));
  await editor.press("Insert"); assert.equal(await page.evaluate(()=>document.getElementById("workbench").editor.viewState.preferences.editorOverwriteMode),true);
  await editor.press("Insert");
  const initialFont=await page.evaluate(()=>document.getElementById("workbench").editor.viewState.preferences.editorFontSize);
  await editor.press("Control+Alt+=");
  await page.waitForFunction(size=>document.getElementById("workbench").editor.viewState.preferences.editorFontSize===size+1,initialFont);
  await editor.press("Control+o"); await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).playback.rate===.75);
  await editor.press("Control+p"); await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).playback.rate===1);
  await editor.press("Control+Shift+c");
  assert.equal((await state()).playing,false); assert.equal((await state()).currentTime,0);
  await page.locator(".timeline-view").focus(); await page.keyboard.press("Control+Shift+x");
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).playing);
  await page.keyboard.press("Control+Shift+x"); await waitForAsync(page, async()=>!(await document.getElementById("workbench").editor.preview.getState()).playing);
  checkpoint="editor hold";
  await editor.focus(); await page.keyboard.down("Alt");
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).settings.pauseDisplayAltHoldActive);
  await page.keyboard.up("Alt");
  await waitForAsync(page, async()=>!(await document.getElementById("workbench").editor.preview.getState()).settings.pauseDisplayAltHoldActive);
  const previewBounds=await page.locator('.preview-container iframe').boundingBox();
  await page.mouse.click(previewBounds.x+previewBounds.width/2,previewBounds.y+previewBounds.height/2);
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),"IFRAME");
  checkpoint="iframe rate";
  await page.keyboard.press("Control+p");
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).playback.rate===1.25);
  checkpoint="iframe play";
  await page.keyboard.press("Control+Shift+x");
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).playing);
  await page.keyboard.press("Control+Shift+x");
  await waitForAsync(page, async()=>!(await document.getElementById("workbench").editor.preview.getState()).playing);
  checkpoint="iframe hold";
  await page.keyboard.down("Alt");
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).settings.pauseDisplayAltHoldActive);
  await page.keyboard.up("Alt");
  await waitForAsync(page, async()=>!(await document.getElementById("workbench").editor.preview.getState()).settings.pauseDisplayAltHoldActive);
  assert.ok(await page.evaluate(()=>shortcutTrace.some(event=>event.id==="preview.speed_up") && shortcutTrace.some(event=>event.id==="preview.play_pause_global")));
  checkpoint="capture and persistence";
  const timeline=page.locator(".timeline-view"), bounds=await timeline.boundingBox();
  const beforeZoom=await page.evaluate(()=>document.getElementById("workbench").editor.workbench.timelineControls.state.zoomScale);
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.keyboard.down("Control"); await page.mouse.wheel(0,-120); await page.keyboard.up("Control");
  await page.waitForFunction(zoom=>document.getElementById("workbench").editor.workbench.timelineControls.state.zoomScale>zoom,beforeZoom);
  await command("page.preferences"); await page.locator('.settings-tabs [data-page="shortcuts"]').click();
  assert.equal(await page.locator(".shortcut-row").count(),25);
  const mirror=()=>page.locator('[data-shortcut-id="transform.mirror_lr"]');
  await mirror().click(); await page.keyboard.press("Control+Alt+q");
  await page.waitForFunction(()=>document.querySelector(".shortcut-recording")?.textContent==="Ctrl+Alt+Q");
  await page.getByRole("dialog",{name:"录制快捷键"}).getByRole("button",{name:"保存",exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem("miacode.web.preferences")).shortcuts?.["transform.mirror_lr"]==="Ctrl+Alt+Q");
  await selectAll(); await editor.press("Control+Alt+q"); await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("8,7"));
  await page.reload(); await page.locator(".welcome-title").waitFor(); await load(); await selectAll();
  await editor.press("Control+Alt+q"); await page.waitForFunction(()=>document.querySelector(".source-input").value.includes("8,7"));
  await command("page.preferences"); await page.locator('.settings-tabs [data-page="shortcuts"]').click();
  await mirror().click(); await page.keyboard.press("Escape"); assert.equal(await page.locator('dialog[open]').count(),0);
  await command("shortcut.reset",{id:"transform.mirror_lr"});
  assert.equal(await page.evaluate(()=>document.getElementById("workbench").editor.viewState.preferences.shortcuts["transform.mirror_lr"]),undefined);
  await mirror().click(); await page.getByRole("button",{name:"清除",exact:true}).click();
  await page.waitForFunction(()=>document.getElementById("workbench").editor.viewState.preferences.shortcuts["transform.mirror_lr"]==="");
  await command("shortcut.resetAll");
  assert.deepEqual(await page.evaluate(()=>document.getElementById("workbench").editor.viewState.preferences.shortcuts),{});
  assert.deepEqual(errors,[]); await page.screenshot({path:join(output,"preferences.png")});
  writeFileSync(join(output,"results.json"),JSON.stringify({initialFont,beforeZoom,bindings:await page.evaluate(()=>document.getElementById("workbench").editor.workbench.documentSession.shortcutRows),errors},null,2)+"\n");
  console.log("25 native shortcut definitions, chart transforms, playback, rate, hold, wheel, font, capture, persistence, clear and reset passed");
} catch (error) {
  const details=await page?.evaluate(async()=>({ trace:window.shortcutTrace,keys:window.shortcutKeyTrace,
    bindings:await document.getElementById("workbench").editor.preview.normalizeShortcuts({hold:"Alt"}),
    state:await document.getElementById("workbench").editor.preview.getState(),focused:document.activeElement.tagName }));
  writeFileSync(join(output,"failure.json"),JSON.stringify({checkpoint,message:error.message,details},null,2)+"\n");
  console.error(JSON.stringify({checkpoint,message:error.message,details}));
  throw error;
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
