import assert from "node:assert/strict";
import test from "node:test";
import { matchesShortcut, shortcutInput, WorkbenchShortcuts } from "../services/shortcuts.mjs";

test("Qt shortcut event mapping preserves modifiers, punctuation and navigation", () => {
  assert.deepEqual(shortcutInput({type:"keydown",key:"+",code:"Equal",ctrlKey:true,shiftKey:true}),
    {key:61,modifiers:0x6000000,wheelDirection:0,text:"Shift+Ctrl+=",modifierOnly:false});
  assert.equal(shortcutInput({type:"keydown",key:"ArrowLeft",altKey:true}).text,"Alt+Left");
  assert.equal(shortcutInput({type:"keydown",key:"F12"}).key,0x100003b);
  assert.equal(shortcutInput({type:"keydown",key:"Control",ctrlKey:true}).text,"Ctrl");
  assert.equal(shortcutInput({type:"keydown",key:"Alt",altKey:true}).modifiers,0);
});
test("Plus binding accepts both shifted equals and keypad plus", () => {
  const binding={canonicalText:"Ctrl++",key:43,modifiers:0x4000000,wheelDirection:0};
  assert.equal(matchesShortcut(binding,shortcutInput({type:"keydown",key:"+",code:"Equal",ctrlKey:true,shiftKey:true})),true);
  assert.equal(matchesShortcut(binding,shortcutInput({type:"keydown",key:"+",code:"NumpadAdd",ctrlKey:true})),true);
  assert.equal(matchesShortcut(binding,shortcutInput({type:"keydown",key:"=",code:"Equal",ctrlKey:true})),false);
});
test("Wheel bindings honor direction, modifiers, and cleared sequences", () => {
  const binding={canonicalText:"Ctrl+WheelUp",key:0,modifiers:0x4000000,wheelDirection:-1};
  assert.equal(matchesShortcut(binding,shortcutInput({type:"wheel",deltaY:-100,ctrlKey:true})),true);
  assert.equal(matchesShortcut(binding,shortcutInput({type:"wheel",deltaY:100,ctrlKey:true})),false);
  assert.equal(matchesShortcut(binding,shortcutInput({type:"wheel",deltaY:-100})),false);
  assert.equal(matchesShortcut({...binding,canonicalText:""},shortcutInput({type:"wheel",deltaY:-100,ctrlKey:true})),false);
});

function shortcuts() {
  const document = new EventTarget(); document.defaultView = new EventTarget();
  const root = { ownerDocument:document, contains:target=>target===root, closest:()=>null };
  const abort = new AbortController();
  const manager = new WorkbenchShortcuts({root,signal:abort.signal,normalize:async sequences =>
    Object.fromEntries(Object.entries(sequences).map(([id,text])=>[id,{canonicalText:text,displayText:text}])),
    execute:()=>{},enabled:()=>true,changed:()=>{},error:error=>{throw error;}});
  return {manager,root,abort};
}

test("holding the play/pause shortcut issues one toggle per key press", () => {
  const { manager, root, abort } = shortcuts(), calls = [];
  manager.bindings = { "preview.play_pause_global": { canonicalText: "Ctrl+Shift+X", key: 88, modifiers: 0x6000000, wheelDirection: 0 } };
  manager.execute = id => calls.push(id);
  const event = { type: "keydown", key: "x", ctrlKey: true, shiftKey: true, target: root, preventDefault() {}, stopImmediatePropagation() {} };
  manager.input(event); manager.input({ ...event, repeat: true });
  assert.deepEqual(calls, ["preview.play_pause_global"]);
  abort.abort();
});
test("Concurrent preference changes retain each shortcut and preserve reset order", async () => {
  const {manager,abort}=shortcuts(); await manager.configure();
  await Promise.all([manager.set("transform.mirror_lr","Alt+J"),manager.set("transform.rotate_180","Alt+L")]);
  assert.deepEqual(manager.overrides,{"transform.mirror_lr":"Alt+J","transform.rotate_180":"Alt+L"});
  await Promise.all([manager.reset("transform.mirror_lr"),manager.set("transform.toggle_ex","Alt+N")]);
  assert.deepEqual(manager.overrides,{"transform.rotate_180":"Alt+L","transform.toggle_ex":"Alt+N"});
  abort.abort();
});
test("Releasing chord modifiers preserves the captured key and supports a modifier-only chord", () => {
  const {manager,root,abort}=shortcuts(), recorded=[]; manager.capture=text=>recorded.push(text);
  const input=(type,key,flags={})=>manager.input({type,key,target:root,preventDefault(){},stopImmediatePropagation(){},...flags});
  input("keydown","Control",{ctrlKey:true}); input("keydown","Alt",{ctrlKey:true,altKey:true});
  input("keydown","q",{ctrlKey:true,altKey:true}); input("keyup","q",{ctrlKey:true,altKey:true});
  input("keyup","Alt",{ctrlKey:true}); input("keyup","Control");
  assert.deepEqual(recorded,["Ctrl+Alt+Q"]);
  input("keydown","Alt",{altKey:true}); input("keyup","Alt");
  assert.deepEqual(recorded,["Ctrl+Alt+Q","Alt"]); abort.abort();
});
