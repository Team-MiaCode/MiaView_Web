import { exportAudioClips, renderExportAudio } from "./export-audio.mjs";
import { drawStageVideo } from "./video-geometry.mjs";

export function exportSettings(input = {}) {
  const resolutions = [[720,720],[960,720],[1280,720],[1080,1080],[1440,1080],[1920,1080],[1440,1440],[1920,1440],[2560,1440]];
  const [width,height] = resolutions[input.resolutionIndex ?? 3] ?? [];
  const settings = { ...input, width: input.width ?? width, height: input.height ?? height, fps: input.fps ?? 60,
    presetIndex: input.presetIndex ?? 1, sizePresetIndex: input.sizePresetIndex ?? 0, audioBitrateKbps: input.audioBitrateKbps ?? 192, format: input.format ?? "auto",
    clockCountEnabled: input.clockCountEnabled ?? true };
  if (![settings.width,settings.height].every(value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 2 === 0))
    throw new Error("视频宽高须为 64 至 4096 的偶数");
  if (![30,60,120].includes(settings.fps)) throw new Error("视频帧率须为 30、60 或 120");
  if (![0,1].includes(settings.presetIndex) || ![0,1,2,3].includes(settings.sizePresetIndex)) throw new Error("视频导出预设无效");
  if (![128,160,192,256,320].includes(settings.audioBitrateKbps)) throw new Error("音频码率无效");
  if (!["auto","mp4","webm"].includes(settings.format)) throw new Error("视频容器无效");
  const size = settings.sizePresetIndex;
  settings.audioBitrateKbps = Math.min(settings.audioBitrateKbps, [320,160,128,128][size]);
  settings.videoBitrate = size >= 2 ? 4e6 : Math.max(size === 1 ? 1.8e6 : 2e6,
    Math.min(size === 1 ? 8e6 : 24e6, settings.width * settings.height * settings.fps * (size === 1 ? .07 : .12)));
  settings.keyFrameInterval = [2,4,6,6][size];
  settings.quantizer = (settings.presetIndex === 0 ? 22 : 18) + [0,1,3,3][size];
  return settings;
}

export async function exportCapabilities(input) {
  const settings = exportSettings(input);
  const media = await import("./vendor/mediabunny/index.mjs");
  const quality = new media.Quality({ bitrate: settings.videoBitrate, quantizer: settings.quantizer });
  const videoOptions = { width: settings.width, height: settings.height, frameRate: settings.fps, quality };
  const audioOptions = { numberOfChannels: 2, sampleRate: 48000, quality: new media.Quality({bitrate:settings.audioBitrateKbps * 1000}) };
  const formats = settings.format === "auto" ? ["mp4","webm"] : [settings.format];
  for (const format of formats) {
    const [videoCodec,audioCodec] = await Promise.all([
      media.getFirstEncodableVideoCodec(format === "mp4" ? ["avc"] : ["vp9","vp8"], videoOptions),
      media.getFirstEncodableAudioCodec(format === "mp4" ? ["aac"] : ["opus"], audioOptions),
    ]);
    if (videoCodec && audioCodec) return { ...settings, format, videoCodec, audioCodec, mimeType: `video/${format}`, extension: `.${format}` };
  }
  throw new Error("浏览器的视频或音频编码器未提供此导出配置");
}

function pauseOverlay(context, width, height) {
  const diameter = Math.max(28, Math.min(width,height) * .17), radius = diameter / 2;
  const barWidth = diameter * .115, barHeight = diameter * .4, gap = barWidth * .85;
  context.fillStyle = "rgba(0,0,0,0.27451)"; context.fillRect(0,0,width,height);
  context.beginPath(); context.arc(width/2,height/2,radius,0,Math.PI*2);
  context.fillStyle = "rgba(17,19,26,0.839216)"; context.fill();
  context.strokeStyle = "rgba(255,255,255,0.784314)"; context.lineWidth = Math.max(1.5,diameter*.028); context.stroke();
  context.fillStyle = "white";
  const left = (width - barWidth*2 - gap)/2;
  context.fillRect(left,(height-barHeight)/2,barWidth,barHeight);
  context.fillRect(left+barWidth+gap,(height-barHeight)/2,barWidth,barHeight);
}

export async function seekVideo(video, second, signal) {
  signal.throwIfAborted();
  const time = Math.min(Math.max(0,second),Math.max(0,video.duration - .000001));
  if (!video.seeking && Math.abs(video.currentTime - time) < .000001) return;
  await new Promise((resolve,reject) => {
    const finish = error => {
      video.removeEventListener("seeked",onSeek); video.removeEventListener("error",onError); signal.removeEventListener("abort",onAbort);
      error ? reject(error) : resolve();
    };
    const onSeek = () => finish(), onError = () => finish(new Error("PV 视频帧读取失败")), onAbort = () => finish(signal.reason);
    video.addEventListener("seeked",onSeek,{once:true}); video.addEventListener("error",onError,{once:true}); signal.addEventListener("abort",onAbort,{once:true});
    video.currentTime = time;
  });
}

// Frame capture remains inside the renderer, before the WebGL drawing buffer is
// cleared. Only progress and the completed file cross the iframe boundary.
export async function encodeVideoExport(adapter, input, signal, progress) {
  try { return await encode(adapter,input,signal,progress); }
  finally { await adapter.finish(); }
}

async function encode(adapter,input,signal,progress) {
  const settings = await exportCapabilities(input);
  signal.throwIfAborted();
  const media = await import("./vendor/mediabunny/index.mjs");
  const canvas = document.createElement("canvas"); canvas.width=settings.width; canvas.height=settings.height;
  const context = canvas.getContext("2d",{alpha:false});
  const writable = input.fileHandle ? await input.fileHandle.createWritable() : null;
  const fileWriter = writable?.getWriter();
  // Commit only after muxing succeeds. Closing/cancelling the muxer's stream
  // leaves the file writer available for an atomic commit or abort.
  const target = fileWriter ? new media.StreamTarget(new WritableStream({write:chunk=>fileWriter.write(chunk)}),{chunked:true,chunkSize:1024*1024}) : new media.BufferTarget();
  const output = new media.Output({ format: settings.format === "mp4" ? new media.Mp4OutputFormat({fastStart:writable?false:"in-memory"}) : new media.WebMOutputFormat(), target });
  const videoSource = new media.CanvasSource(canvas,{ codec:settings.videoCodec, quality:new media.Quality({bitrate:settings.videoBitrate,quantizer:settings.quantizer}),keyFrameInterval:settings.keyFrameInterval });
  const audioSource = new media.AudioBufferSource({codec:settings.audioCodec,quality:new media.Quality({bitrate:settings.audioBitrateKbps*1000})});
  output.addVideoTrack(videoSource,{frameRate:settings.fps}); output.addAudioTrack(audioSource);
  let plan;
  try {
    plan = await adapter.prepare(settings,signal);
    signal.throwIfAborted();
    const clips = exportAudioClips(plan,adapter.track(),adapter.sounds());
    const totalSamples = Math.round(plan.totalSeconds*48000);
    let nextSample = 0, lastProgress = 0;
    await output.start();
    for (let index=0;index<plan.frameCount;index++) {
      signal.throwIfAborted();
      if (nextSample < totalSamples && nextSample / 48000 <= index/settings.fps) {
        const count = Math.min(48000,totalSamples-nextSample);
        const audio = await renderExportAudio(clips,nextSample,count);
        signal.throwIfAborted(); await audioSource.add(audio); nextSample += count;
      }
      const frame = adapter.frameInfo(index);
      const videoFrame = adapter.video()?.src && !adapter.hidePv() && settings.sizePresetIndex !== 3 ? await adapter.videoFrame(frame.mediaSecond, signal) : null;
      await adapter.capture(index,signal,source => {
        context.globalAlpha=1;context.fillStyle="black";context.fillRect(0,0,canvas.width,canvas.height);
        if (videoFrame && !adapter.hidePv()) {
          // The same geometry as the live preview's media plane.
          context.save(); context.globalAlpha=frame.mediaOpacity;
          drawStageVideo(context,videoFrame,adapter.mediaGeometry(videoFrame));context.restore();
        }
        context.drawImage(source,0,0,canvas.width,canvas.height);
        if(frame.pauseOverlay)pauseOverlay(context,canvas.width,canvas.height);
      });
      signal.throwIfAborted(); await videoSource.add(index/settings.fps,1/settings.fps);
      if (performance.now()-lastProgress>=200 || index===plan.frameCount-1) {
        lastProgress=performance.now();progress({stage:"encoding",frame:index+1,frameCount:plan.frameCount,progress:(index+1)/plan.frameCount});
      }
    }
    while(nextSample<totalSamples) {
      signal.throwIfAborted();const count=Math.min(48000,totalSamples-nextSample);
      await audioSource.add(await renderExportAudio(clips,nextSample,count)); nextSample+=count;
    }
    signal.throwIfAborted(); await output.finalize();
    if(fileWriter)await fileWriter.close();
    return { format:settings.format,mimeType:settings.mimeType,extension:settings.extension,width:settings.width,height:settings.height,
      fps:settings.fps,videoCodec:settings.videoCodec,audioCodec:settings.audioCodec,frameCount:plan.frameCount,duration:plan.totalSeconds,
      fileName:input.fileHandle?.name ?? null,blob:writable?null:new Blob([target.buffer],{type:settings.mimeType}) };
  } catch(error) {
    await Promise.allSettled([output.cancel(),fileWriter?.abort(error)]); throw error;
  }
}
