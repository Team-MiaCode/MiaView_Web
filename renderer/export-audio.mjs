// The native export plan owns timing, note semantics and effective channel gains.
// This adapter renders bounded PCM blocks for the browser's audio encoder.
export function exportAudioClips(plan, track, sounds) {
  const clips = [];
  const append = (item, buffer, duration = item.durationSeconds) => {
    if (!buffer || !(item.gain > 0)) return;
    const offset = item.sourceStartSecond ?? 0;
    const available = buffer.duration - offset;
    const length = duration >= 0 ? Math.min(duration, available) : available;
    if (length > 0) clips.push({ ...item, buffer, mixSecond:item.mixSecond??item.mixStartSecond,
      sourceStartSecond: offset, durationSeconds: length, envelopeDurationSeconds:duration>=0?duration:length });
  };
  for (const item of [plan.backgroundTrack, plan.introPreviewTrack])
    if (item.enabled) append(item, track);
  for (const item of plan.scheduledSfxPlaybacks) append(item, sounds.get(item.file), item.maxDurationSeconds);
  for (const item of plan.touchholdSpanPlaybacks) append(item, sounds.get(item.file));
  return clips;
}

export function clipGainAt(clip, second) {
  const position = second - clip.mixSecond;
  const {duration,fadeIn,fadeOut}=clipFades(clip);
  const head = fadeIn>0 ? sampledSmooth(position/fadeIn) : 1;
  const tail = fadeOut>0 ? 1-sampledSmooth((position-(duration-fadeOut))/fadeOut) : 1;
  return clip.gain*Math.min(head,tail);
}
function clipFades(clip) {
  const duration=clip.envelopeDurationSeconds??clip.durationSeconds;
  const fadeIn=Math.max(0,Math.min(clip.fadeInSeconds??0,duration));
  return {duration,fadeIn,fadeOut:Math.max(0,Math.min(clip.fadeOutSeconds??0,duration-fadeIn))};
}
function sampledSmooth(value) {
  const scaled=Math.max(0,Math.min(1,value))*16,index=Math.min(15,Math.floor(scaled));
  const smooth=value=>value*value*(3-2*value),a=smooth(index/16),b=smooth((index+1)/16);
  return a+(b-a)*(scaled-index);
}
export function clipGainPoints(clip) {
  const {duration,fadeIn,fadeOut}=clipFades(clip),points=[];
  // BassExportAudioBackend.cpp samples each smoothstep ramp at 16 steps.
  for(let index=0;index<=16;index++) {
    points.push(clip.mixSecond+fadeIn*index/16);
    points.push(clip.mixSecond+duration-fadeOut+fadeOut*index/16);
  }
  return [...new Set(points)].sort((a,b)=>a-b);
}

export async function renderExportAudio(clips, firstSample, sampleCount, sampleRate = 48000) {
  const Context = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  const context = new Context(2, sampleCount, sampleRate);
  const start = firstSample / sampleRate, end = (firstSample + sampleCount) / sampleRate;
  for (const clip of clips) {
    const from = Math.max(start, clip.mixSecond), to = Math.min(end, clip.mixSecond + clip.durationSeconds);
    if (to <= from) continue;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = clip.buffer; source.connect(gain); gain.connect(context.destination);
    gain.gain.setValueAtTime(clipGainAt(clip, from), from - start);
    const points=[...clipGainPoints(clip),to];
    for (const second of [...new Set(points)].filter(second => second > from && second <= to).sort((a,b) => a-b))
      gain.gain.linearRampToValueAtTime(clipGainAt(clip, second), second - start);
    source.start(from - start, clip.sourceStartSecond + from - clip.mixSecond, to - from);
  }
  return context.startRendering();
}
