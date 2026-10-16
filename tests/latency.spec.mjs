import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LATENCY, latencySettings } from "../renderer/latency.mjs";
test("Latency settings retain finite offsets and accepted subdivisions",()=>{
  assert.equal(latencySettings(DEFAULT_LATENCY,{offsetSeconds:-.25,subdivision:16}).offsetSeconds,-.25);
  for(const value of [{bpm:0},{bpm:Infinity},{subdivision:12},{offsetSeconds:NaN},{sfxVolumePercent:100.5},{onPage:1},{unknown:0}])
    assert.throws(()=>latencySettings(DEFAULT_LATENCY,value));
});
