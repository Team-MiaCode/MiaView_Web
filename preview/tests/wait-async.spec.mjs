import assert from "node:assert/strict";
import test from "node:test";
import {waitForAsync} from "./helpers/wait-async.mjs";

test("Browser polling awaits false promises until the business condition becomes true",async()=>{
  let attempts=0;
  const page={evaluate:async()=>++attempts===3};
  assert.equal(await waitForAsync(page,()=>false,undefined,{polling:1,timeout:1000}),true);
  assert.equal(attempts,3);
});
test("Browser polling preserves evaluation failures and bounds unresolved predicates",async()=>{
  await assert.rejects(waitForAsync({evaluate:async()=>{throw new Error("evaluation failed");}},()=>false),/evaluation failed/);
  await assert.rejects(waitForAsync({evaluate:()=>new Promise(()=>{})},()=>false,undefined,{timeout:10}),/timed out/);
});
