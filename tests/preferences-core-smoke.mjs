import { observeFilePicker } from "./helpers/file-picker.mjs";
import { launchPreviewBrowser } from "./preview-browser.mjs";
import { waitForAsync } from "./helpers/wait-async.mjs";
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {staticServer} from "../scripts/serve.mjs";

const browsers=await import(process.env.MIACODE_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MIACODE_PLAYWRIGHT_MODULE).href:"playwright");
const output=resolve("artifacts/preferences-core");mkdirSync(output,{recursive:true});
const server=staticServer(process.cwd(),{performanceTerminal:false});await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await launchPreviewBrowser(browsers, process.env.MIACODE_BROWSER || "chromium");
let page;
try {
  page=await browser.newPage({viewport:{width:1366,height:900}});page.setDefaultTimeout(30000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  const command=(id,args)=>page.evaluate(({id,args})=>document.getElementById("workbench").editor.command(id,args),{id,args});
  const state=()=>page.evaluate(()=>document.getElementById("workbench").editor.preview.getState());
  await observeFilePicker(page);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.locator(".welcome-title").waitFor();await page.evaluate(()=>document.getElementById("workbench").editor.ready);
  const defaults=await page.evaluate(()=>document.getElementById("workbench").editor.preview.normalizeBackground());
  assert.equal(defaults.opacity,.2);assert.equal(defaults.panelAlpha,200);
  const clamped=await page.evaluate(()=>document.getElementById("workbench").editor.preview.normalizeBackground({opacity:2,blur:99,panelAlpha:-1,overlays:{card_dark:0},sizeMode:"contain",position:"left_top"}));
  assert.equal(clamped.opacity,.8);assert.equal(clamped.blur,64);assert.equal(clamped.panelAlpha,0);assert.equal(clamped.overlays.card_dark,255);
  await page.evaluate(async()=>{
    const editor=document.getElementById("workbench").editor;
    await Promise.all([editor.command("preferences.background",{opacity:.6}),editor.command("preferences.background",{blur:12})]);
  });
  assert.deepEqual(await page.evaluate(()=>{const settings=document.getElementById("workbench").editor.viewState.preferences.appBackground;return {opacity:settings.opacity,blur:settings.blur};}),{opacity:.6,blur:12});
  const before=await page.locator(".editor-content").screenshot();
  await command("page.preferences");await page.locator('.settings-tabs [data-page="background"]').click();
  const chooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"选择图片",exact:true}).click();
  await(await chooser).setFiles(resolve("ui/components/icons/app.png"));
  await page.waitForFunction(()=>document.getElementById("workbench").editor.viewState.preferences.appBackground.imagePath==="app.png");
  await page.getByRole("switch",{name:"启用应用背景",exact:true}).check();
  await page.waitForFunction(()=>document.querySelector(".workbench").classList.contains("app-background-active"));
  await command("preferences.background",{opacity:.8,panelAlpha:0});await command("page.welcome");
  const after=await page.locator(".editor-content").screenshot();assert.notDeepEqual(after,before);
  await page.screenshot({path:join(output,"background.png")});
  await command("page.preferences");await page.locator('.settings-tabs [data-page="background"]').click();
  const modes={cover:"cover",contain:"contain",stretch:"100% 100%",center:"auto",repeat:"auto"};
  for(const [mode,size] of Object.entries(modes)) {
    await page.getByRole("combobox",{name:"缩放模式",exact:true}).selectOption(mode);
    await page.waitForFunction(mode=>document.getElementById("workbench").editor.viewState.preferences.appBackground.sizeMode===mode,mode);
    assert.equal(await page.locator(".workbench").evaluate(node=>getComputedStyle(node,"::before").backgroundSize),size);
  }
  await command("preferences.background",{position:"right_bottom",blur:16});
  const appearance=await page.locator(".workbench").evaluate(node=>({position:getComputedStyle(node,"::before").backgroundPosition,filter:getComputedStyle(node,"::before").filter,url:getComputedStyle(node,"::before").backgroundImage}));
  assert.equal(appearance.position,"100% 100%");assert.equal(appearance.filter,"blur(16px)");
  await page.evaluate(()=>document.getElementById("workbench").editor.viewState.setPreference("blurMaterialsEnabled",false));
  assert.equal(await page.locator(".workbench").evaluate(node=>getComputedStyle(node,"::before").filter),"blur(0px)");
  const invalidPicker=page.waitForEvent("filechooser");
  const invalid=page.evaluate(async()=>{try{await document.getElementById("workbench").editor.command("background.choose");return false;}catch{return true;}});
  await(await invalidPicker).setFiles({name:"invalid.png",mimeType:"image/png",buffer:Buffer.from("invalid")});assert.equal(await invalid,true);
  assert.equal(await page.locator(".workbench").evaluate(node=>getComputedStyle(node,"::before").backgroundImage),appearance.url);
  await page.reload();await page.waitForFunction(() => document.getElementById("workbench")?.editor);await page.evaluate(()=>document.getElementById("workbench").editor.ready);
  assert.equal(await page.locator(".workbench").evaluate(node=>node.classList.contains("app-background-active")),true);
  await command("page.preferences");await page.locator('.settings-tabs [data-page="background"]').click();
  await page.getByRole("button",{name:"清除",exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector(".workbench").classList.contains("app-background-active"));
  await page.evaluate(async()=>{
    const editor=document.getElementById("workbench").editor;
    await editor.load({maidata:"&title=Font Preview 012345\n&artist=User Font\n&inote_5=(120){4}1,2,E\n"});
    await editor.command("preview.settings",{showChartInfoHud:true,showTimestamp:true});
    await editor.preview.setCanvasSize({width:1920,height:1080});
  });
  const canvas=page.frameLocator('.preview-container iframe').locator('#qt-screen canvas');
  const initialFrame=await canvas.screenshot();
  await page.evaluate(()=>{
    const p=document.getElementById("workbench").editor.preview.windowRouter.owner, set=p.setSettings.bind(p);
    window.fontTrace=[];p.setSettings=async settings=>{
      const result=await set(settings);fontTrace.push({settings,result:result.hudFontPaths});return result;
    };
  });
  await command("page.preview-settings");await page.locator('.settings-tabs [data-page="skin"]').click();
  const fontFile=resolve("vendor/MiaCode/src/intro/assets/fonts/ResourceHanRoundedCN-Bold.ttf");
  const fontChooser=page.waitForEvent("filechooser");await page.getByRole("button",{name:"导入字体…",exact:true}).click();await(await fontChooser).setFiles(fontFile);
  await waitForAsync(page, async()=>Boolean((await document.getElementById("workbench").editor.preview.getState()).settings.hudFontPaths.chart_info));
  const first=(await state()).settings.hudFontPaths.chart_info;
  assert.match(first,/^\/web-fonts\/[a-f\d]{64}\.ttf$/);
  const customFrame=await canvas.screenshot();assert.notDeepEqual(initialFrame,customFrame);
  for(const [index,area] of [[2,"center_display"],[3,"object_stats"],[4,"debug_info"]]) {
    await page.getByRole("combobox",{name:"区域",exact:true}).selectOption(String(index));
    await page.waitForFunction(index=>document.getElementById("workbench").editor.workbench.documentSession.previewValues.hudFontAreaIndex===index,index);
    await page.getByRole("combobox",{name:"字体",exact:true}).selectOption(first);
    await waitForAsync(page, async area=>(await document.getElementById("workbench").editor.preview.getState()).settings.hudFontPaths[area]!=="",area);
  }
  await page.getByRole("combobox",{name:"区域",exact:true}).selectOption("1");
  await page.waitForFunction(()=>document.getElementById("workbench").editor.workbench.documentSession.previewValues.hudFontAreaIndex===1);
  await page.getByRole("combobox",{name:"字体",exact:true}).selectOption(first);
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).settings.hudFontPaths.timestamp!=="");
  await page.getByRole("button",{name:"还原",exact:true}).click();
  await waitForAsync(page, async()=>(await document.getElementById("workbench").editor.preview.getState()).settings.hudFontPaths.timestamp==="");
  assert.equal((await state()).settings.hudFontPaths.chart_info,first);
  for(const area of ["center_display","object_stats","debug_info"])assert.equal((await state()).settings.hudFontPaths[area],first);
  const invalidFont=await page.evaluate(async()=>{const p=document.getElementById("workbench").editor.preview;try{await p.importFont(new Blob(["invalid"]),"invalid.ttf");return false;}catch{return true;}});
  assert.equal(invalidFont,true);assert.equal((await state()).settings.hudFontPaths.chart_info,first);
  const font=await page.evaluate(()=>document.getElementById("workbench").editor.preview.importFont(new URL("vendor/MiaCode/src/intro/assets/fonts/ResourceHanRoundedCN-Bold.ttf",location.href).href,"same-font.otf"));
  assert.equal(font.path,first);
  await page.reload();await page.waitForFunction(() => document.getElementById("workbench")?.editor);await page.evaluate(()=>document.getElementById("workbench").editor.ready);
  const restored=await state();assert.equal(restored.settings.hudFontPaths.chart_info,first);
  assert.equal(await page.evaluate(()=>document.getElementById("workbench").editor.workbench.documentSession.userFonts.length),1);
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,"results.json"),JSON.stringify({browser:browser.version(),defaults,clamped,appearance,font,restored:restored.settings,errors},null,2)+"\n");
  console.log("Native background defaults, five scale modes, opacity, blur, storage, HUD font import, five-area state, reset and reload passed");
} catch(error) {
  const details=await page?.evaluate(async()=>({trace:window.fontTrace,settings:(await document.getElementById("workbench").editor.preview.getState()).settings,
    values:document.getElementById("workbench").editor.viewState.preferences.previewValues,fonts:document.getElementById("workbench").editor.workbench.documentSession.userFonts,
    status:document.getElementById("workbench").editor.workbench.statusLabel.textContent}));
  writeFileSync(join(output,"failure.json"),JSON.stringify({message:error.message,details},null,2)+"\n");throw error;
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
