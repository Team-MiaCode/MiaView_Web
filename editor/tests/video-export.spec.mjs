import test from "node:test";
import assert from "node:assert/strict";
import {exportSettings} from "../renderer/video-export.mjs";
import {clipGainAt,clipGainPoints,exportAudioClips} from "../renderer/export-audio.mjs";
import {videoFileName} from "../services/video-export-jobs.mjs";

test("Export filenames preserve the selected stem and browser-supported extension",()=>{
  assert.equal(videoFileName("D:\\Music\\Song.MP4",".webm"),"Song.webm");
  assert.equal(videoFileName("title:*?.mp4",".mp4"),"title___.mp4");
  assert.equal(videoFileName("..",".mp4"),"MiaCode.mp4");
});

test("Export size presets keep selected dimensions and cap audio/video rates",()=>{
  const compact=exportSettings({resolutionIndex:5,fps:120,sizePresetIndex:1,audioBitrateKbps:320});
  assert.equal(compact.width,1920);assert.equal(compact.height,1080);assert.equal(compact.audioBitrateKbps,160);assert.equal(compact.videoBitrate,8e6);
  const ultra=exportSettings({sizePresetIndex:3,audioBitrateKbps:256});
  assert.equal(ultra.videoBitrate,4e6);assert.equal(ultra.audioBitrateKbps,128);
  assert.equal(ultra.keyFrameInterval,6);
  for(const input of [{width:321,height:180},{width:8192,height:8192},{fps:50},{format:"gif"},{sizePresetIndex:4},{audioBitrateKbps:1}])
    assert.throws(()=>exportSettings(input));
});

test("Export PCM clips retain native source offsets, truncation and channel gain",()=>{
  const track={duration:20},tap={duration:2},hold={duration:8};
  const clips=exportAudioClips({backgroundTrack:{enabled:true,mixStartSecond:1.5,sourceStartSecond:4,durationSeconds:2,gain:.4},
    introPreviewTrack:{enabled:false},scheduledSfxPlaybacks:[{file:"tap",mixSecond:2,gain:.6,maxDurationSeconds:.3},{file:"tap",mixSecond:3,gain:0,maxDurationSeconds:-1}],
    touchholdSpanPlaybacks:[{file:"hold",mixSecond:1.5,sourceStartSecond:3,durationSeconds:9,gain:.7}]},track,new Map([["tap",tap],["hold",hold]]));
  assert.equal(clips.length,3);assert.equal(clips[0].sourceStartSecond,4);assert.equal(clips[1].durationSeconds,.3);
  assert.equal(clips[0].mixSecond,1.5);
  assert.equal(clips[2].durationSeconds,5);assert.equal(clips[2].sourceStartSecond,3);assert.equal(clips[2].gain,.7);
});

test("Intro gain ramps retain their absolute envelope across PCM block boundaries",()=>{
  const clip={mixSecond:2,durationSeconds:8,gain:.6,fadeInSeconds:.8,fadeOutSeconds:2};
  assert.equal(clipGainAt(clip,2),0);assert.ok(Math.abs(clipGainAt(clip,2.4)-.3)<1e-12);
  assert.ok(Math.abs(clipGainAt(clip,2.2)-.09375)<1e-12);
  assert.ok(clipGainPoints(clip).includes(2.05));assert.ok(clipGainPoints(clip).includes(9.875));
  assert.equal(clipGainAt(clip,5),.6);assert.equal(clipGainAt(clip,9),.3);assert.equal(clipGainAt(clip,10),0);
});
