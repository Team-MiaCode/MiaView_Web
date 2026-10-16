import {restorePreviewAppearance} from "./user-appearance.mjs";
import {createPreview} from "../sdk/index.mjs";

export function videoFileName(name,extension) {
  return `${(name||"MiaCode").split(/[\\/]/).at(-1).replace(/\.(mp4|webm)$/i,"").replace(/[<>:"|?*\x00-\x1f]/g,"_").replace(/[. ]+$/g,"")||"MiaCode"}${extension}`;
}

// Each export owns a renderer and an immutable document/resource snapshot.
// The main workbench continues editing while the export consumes its snapshot.
export class VideoExportJobs {
  constructor({root,previewOptions,assets,fonts,changed,deliver}) {
    Object.assign(this,{root,previewOptions,assets,fonts,changed,deliver});
  }
  publish(value) {this.state={...this.state,...value};this.changed(this.state);}
  start(request,settings,snapshot) {
    if(this.state?.running)throw new Error("视频导出任务运行中");
    this.controller=new AbortController();
    this.publish({running:true,progress:0,message:"载入导出快照",cancelled:false});
    this.promise=this.run(request,settings,snapshot,this.controller.signal).then(result=>{
      this.publish({running:false,progress:1,message:`导出完成：${result.filename}`});return result;
    },error=>{
      const cancelled=this.controller.signal.aborted;
      this.publish({running:false,message:cancelled?"视频导出取消":error.message,cancelled});
      if(!cancelled)throw error;
      return {cancelled:true};
    });
    void this.promise.catch(()=>{});
    return this.promise;
  }
  async run(request,settings,snapshot,signal) {
    const host=document.createElement("div");host.className="export-render-host";
    Object.assign(host.style,{position:"fixed",left:"0",top:"0",width:"320px",height:"180px",opacity:"0",pointerEvents:"none",zIndex:"-1"});
    this.root.append(host);
    const preview=this.preview=createPreview(host,{...this.previewOptions,resolution:{width:320,height:180},controls:false});
    try {
      await preview.ready;signal.throwIfAborted();
      const fontPaths=new Set([...Object.values(snapshot.settings.hudFontPaths||{}),settings.introFontDisplayPath,settings.introFontBodyPath].filter(Boolean));
      for(const font of (await this.fonts()).filter(font=>fontPaths.has(font.path))) {signal.throwIfAborted();await preview.importFont(font.file,font.file.name);}
      await restorePreviewAppearance(preview,this.assets,snapshot.settings);
      await preview.setSettings({...snapshot.settings,pauseDisplayAltHoldActive:false,touchPadAuthoringContext:false});
      await preview.audioCommand("audio.restoreSettings",{settings:snapshot.audio});
      await preview.setPerformance(snapshot.performance);
      await preview.setMediaSettings({hidePv:snapshot.hidePv});
      const capabilities=await preview.getExportCapabilities(settings);
      signal.throwIfAborted();
      await preview.load({...request.chart,difficulty:null});
      await preview.selectDifficulty(request.difficulty);
      const filename=videoFileName(request.fileName,capabilities.extension);
      signal.throwIfAborted();
      const off=preview.on("exportProgress",event=>this.publish({progress:event.progress,
        message:`${filename} · ${event.frame}/${event.frameCount} 帧`}));
      let detach=[];
      const result=new Promise((resolve,reject)=>{
        detach=[preview.on("exportCompleted",resolve),preview.on("exportFailed",event=>reject(new Error(event.message)))];
      });
      // Install completion handlers before sending the start command.
      void result.catch(()=>{});
      try {
        this.exporting=true;
        await preview.startExport({...settings,fileHandle:request.fileHandle});
        if(signal.aborted)await preview.cancelExport();
        const video=await result;signal.throwIfAborted();
        await this.deliver(video,filename);
        return {filename,difficulty:request.difficulty,frameCount:video.frameCount,duration:video.duration};
      } finally {this.exporting=false;off();for(const remove of detach)remove();}
    } finally {this.preview=null;preview.destroy();host.remove();}
  }
  async cancel() {
    this.controller?.abort(new DOMException("视频导出取消","AbortError"));
    if(this.preview){if(this.exporting)await this.preview.cancelExport();else this.preview.destroy();}
    await this.promise;
  }
  destroy() {this.controller?.abort(new DOMException("工作台关闭","AbortError"));this.preview?.destroy();}
}
