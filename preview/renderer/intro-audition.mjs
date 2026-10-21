export function introTrackGain(plan, second) {
  const clip=plan.introPreviewTrack;
  if(!clip.enabled)return 0;
  const smooth=value=>{value=Math.max(0,Math.min(1,value));return value*value*(3-2*value);};
  const head=clip.fadeInSeconds>0?smooth(second/clip.fadeInSeconds):1;
  const tail=clip.fadeOutSeconds>0?1-smooth((second-(clip.durationSeconds-clip.fadeOutSeconds))/clip.fadeOutSeconds):1;
  // IntroRegion.cpp applies the preview envelope in 1/32 volume steps.
  return clip.gain*Math.round(Math.min(head,tail)*32)/32;
}

export class IntroAudition {
  constructor({context,track,video,hidePv,frame,still,changed,failed,softwareVideo=()=>false,presentVideo=()=>{}}) {
    Object.assign(this,{context,track,video,hidePv,frame,still,changed,failed,softwareVideo,presentVideo});
    this.playing=false;this.introAuditionLoop=false;this.elapsed=0;this.lastFrame=-1;this.mediaGeneration=0;
  }
  configure(plan,settings) {
    this.stopSources();this.playing=false;this.plan=plan;this.settings=settings;
    this.elapsed=0;this.lastFrame=-1;this.lastPublish=0;this.still(true);this.tick();this.publish();
  }
  state() {return {active:true,playing:this.playing,introAuditionLoop:this.introAuditionLoop,elapsed:this.position(),
    duration:this.plan.introAuditionSeconds,introPvStartSeconds:this.settings.introPvStartSeconds??0};}
  publish() {this.lastPublish=this.context.currentTime;this.changed(this.state());}
  position() {return this.playing?this.elapsed+Math.max(0,this.context.currentTime-this.startedAt):this.elapsed;}
  stopSources() {
    this.cancelPlay?.();this.cancelPlay=null;
    ++this.mediaGeneration;
    if(this.source){this.source.onended=null;this.source.stop();this.source.disconnect();this.source=null;}
    if(this.gain){this.gain.disconnect();this.gain=null;}
    this.video.pause();
  }
  startSources() {
    const clip=this.plan.introPreviewTrack, elapsed=this.elapsed;
    if(this.track&&clip.enabled&&clip.sourceStartSecond+elapsed<this.track.duration&&elapsed<clip.durationSeconds) {
      const source=this.source=this.context.createBufferSource(),gain=this.gain=this.context.createGain();
      source.buffer=this.track;gain.gain.value=0;source.connect(gain);gain.connect(this.context.destination);
      source.onended=()=>{source.disconnect();gain.disconnect();if(this.source===source){this.source=null;this.gain=null;}};
      source.start(this.context.currentTime,clip.sourceStartSecond+elapsed,Math.min(clip.durationSeconds-elapsed,this.track.duration-clip.sourceStartSecond-elapsed));
    }
    this.lastGain=-1;
    if(this.video.src&&!this.hidePv()&&!this.softwareVideo()){
      this.video.currentTime=Math.min((this.settings.introPvStartSeconds??0)+elapsed,Math.max(0,this.video.duration-.000001));
      this.video.playbackRate=1;
      const generation=this.mediaGeneration;
      if(this.video.currentTime<this.video.duration-.02)void this.video.play().catch(error=>{if(this.playing&&generation===this.mediaGeneration)this.failed(error);});
    }
  }
  async play(elapsed=this.elapsed) {
    if(this.playing)return;
    elapsed%=this.plan.introAuditionSeconds;
    this.cancelPlay?.();
    let cancel;
    const cancelled=new Promise(resolve=>{cancel=()=>resolve(false);});this.cancelPlay=cancel;
    try {
      const resumed=await Promise.race([this.context.resume().then(()=>true),cancelled]);
      if(!resumed||this.cancelPlay!==cancel)return;
      this.cancelPlay=null;
      this.stopSources();this.elapsed=elapsed;this.startedAt=this.context.currentTime;
      this.playing=true;this.lastFrame=-1;this.still(false);this.startSources();this.tick();this.publish();
    } finally {if(this.cancelPlay===cancel)this.cancelPlay=null;}
  }
  pause(elapsed=this.position()) {
    this.stopSources();this.playing=false;this.elapsed=Math.max(0,Math.min(this.plan.introAuditionSeconds,elapsed));this.lastFrame=-1;this.still(true);this.tick();this.publish();
  }
  tick() {
    let elapsed=this.position();
    if(this.playing&&elapsed>=this.plan.introAuditionSeconds) {
      if(!this.introAuditionLoop){this.pause(0);return;}
      this.stopSources();this.startedAt=this.context.currentTime;this.elapsed=elapsed=0;this.lastFrame=-1;this.startSources();this.publish();
    }
    if(this.gain){const gain=introTrackGain(this.plan,elapsed);if(gain!==this.lastGain){this.gain.gain.value=gain;this.lastGain=gain;}}
    const index=Math.min(this.plan.frameCount-1,Math.floor(elapsed*this.plan.fps));
    if(index!==this.lastFrame){
      this.lastFrame=index;const info=this.frame(index);
      if(this.video.src&&!this.hidePv()){
        const target=Math.min(info.mediaSecond,Math.max(0,this.video.duration-.000001));
        this.video.style.opacity=String(this.playing?info.mediaOpacity:1);
        this.presentVideo(target);
        if(!this.softwareVideo()&&(!this.playing||Math.abs(this.video.currentTime-target)>.1))this.video.currentTime=target;
        if(target>=this.video.duration-.02)this.video.pause();
      }
    }
    if(this.playing&&this.context.currentTime-this.lastPublish>=.1){this.lastPublish=this.context.currentTime;this.publish();}
  }
  destroy() {this.stopSources();this.video.style.opacity="";}
}
