import test from "node:test";
import assert from "node:assert/strict";
import {IntroAudition,introTrackGain} from "../renderer/intro-audition.mjs";

const plan={fps:60,frameCount:1400,introAuditionSeconds:7.75,introPreviewTrack:{enabled:true,sourceStartSecond:.7,durationSeconds:7.75,gain:.3,fadeInSeconds:.8,fadeOutSeconds:2}};
test("PV audition uses the upstream smoothstep envelope and 1/32 preview gain steps",()=>{
  assert.equal(introTrackGain(plan,0),0);assert.equal(introTrackGain(plan,.2),.3*5/32);
  assert.equal(introTrackGain(plan,.4),.15);assert.equal(introTrackGain(plan,2),.3);
  assert.equal(introTrackGain(plan,7.25),.3*5/32);assert.equal(introTrackGain(plan,7.75),0);
  assert.equal(introTrackGain({...plan,introPreviewTrack:{enabled:false}},1),0);
});
test("PV audition loops from its selected source position, parks on a still and releases voices",async()=>{
  const sources=[],gains=[],frames=[],stills=[],events=[];
  const context={currentTime:0,resume:async()=>{},destination:{},createGain(){const node={gain:{value:0},connect(){},disconnect(){this.disconnected=true;}};gains.push(node);return node;},
    createBufferSource(){const node={connect(){},disconnect(){this.disconnected=true;},start(...args){this.started=args;},stop(){this.stopped=true;}};sources.push(node);return node;}};
  const video={src:"",style:{},pause(){}};
  const audition=new IntroAudition({context,track:{duration:12},video,hidePv:()=>false,frame:index=>{frames.push(index);return{};},still:value=>stills.push(value),changed:value=>events.push(value),failed:error=>{throw error;}});
  audition.configure(plan,{introPvStartSeconds:.7});await audition.play();
  await audition.play();assert.equal(sources.length,1);
  assert.equal(sources[0].started[1],.7);context.currentTime=.2;audition.tick();assert.equal(gains[0].gain.value,.3*5/32);
  audition.introAuditionLoop=true;context.currentTime=7.8;audition.tick();
  assert.equal(sources.length,2);assert.equal(sources[0].stopped,true);assert.equal(sources[1].started[1],.7);assert.equal(audition.state().elapsed,0);
  audition.pause();assert.equal(audition.state().playing,false);assert.equal(audition.state().elapsed,0);assert.equal(stills.at(-1),true);assert.equal(frames.at(-1),0);
  assert.ok(sources.every(source=>source.stopped&&source.disconnected));assert.ok(gains.every(gain=>gain.disconnected));
  audition.destroy();assert.equal(video.style.opacity,"");assert.equal(events.at(-1).playing,false);
});

test("moving an audition to another renderer parks and resumes at its elapsed position", async () => {
  let started, frame;
  const context = { currentTime: 10, resume: async () => {}, destination: {},
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {}, start(...args) { started = args; } }) };
  const video = { src: "pv", duration: 12, style: {}, pause() {}, play: async () => {} };
  const audition = new IntroAudition({ context, track: { duration: 12 }, video, hidePv: () => false,
    frame: index => { frame = index; return { mediaSecond: .7 + index / 60, mediaOpacity: 1 }; },
    still() {}, changed() {}, failed: error => { throw error; } });
  audition.configure(plan, { introPvStartSeconds: .7 });
  audition.pause(2.5);
  assert.equal(audition.state().elapsed, 2.5); assert.equal(audition.state().playing, false);
  assert.equal(started, undefined); assert.equal(frame, 150);
  await audition.play();
  assert.deepEqual(started, [10, 3.2, 5.25]);
  assert.equal(frame, 150); assert.equal(video.currentTime, 3.2); assert.equal(video.playbackRate, 1);
  context.currentTime = 10.25; audition.tick(); assert.equal(audition.state().elapsed, 2.75);
  audition.pause(); assert.equal(audition.state().elapsed, 2.75);
  audition.destroy();
});

test("pausing an intro settles a pending audio start before its context resumes", { timeout: 1000 }, async () => {
  let resume, sources = 0;
  const context = { currentTime: 10, resume: () => new Promise(resolve => { resume = resolve; }),
    createBufferSource: () => { sources++; throw new Error("Cancelled intro started audio"); } };
  const audition = new IntroAudition({ context, track: { duration: 12 }, video: { src: "", style: {}, pause() {} },
    hidePv: () => false, frame: () => ({}), still() {}, changed() {}, failed: error => { throw error; } });
  audition.configure(plan, { introPvStartSeconds: .7 });
  const pending = audition.play();
  audition.pause(); await pending;
  assert.equal(audition.state().playing, false); assert.equal(sources, 0);
  resume(); await Promise.resolve();
  assert.equal(audition.state().playing, false); assert.equal(sources, 0);
  audition.destroy();
});
