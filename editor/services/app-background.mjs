export class AppBackground {
  constructor(root, viewState, assets, normalize) {
    Object.assign(this,{root,viewState,assets,normalize}); this.sequence=0;this.pending=Promise.resolve();
    this.changed=()=>this.apply(); viewState.addEventListener("change",this.changed);
  }
  async restore() {
    const item=await this.assets.get("app-background");
    if (item) await this.replace(item.file,false);
    else this.apply();
  }
  update(values) {
    const operation=this.pending.then(async()=>{
      const settings=await this.normalize({...this.viewState.preferences.appBackground,...values});
      this.viewState.setPreference("appBackground",settings);return settings;
    });
    this.pending=operation.catch(()=>{});return operation;
  }
  async replace(file,persist=true) {
    const sequence=++this.sequence, url=URL.createObjectURL(file), image=new Image(); image.src=url;
    try {
      await image.decode();
      if (sequence!==this.sequence) { URL.revokeObjectURL(url);return; }
      if (persist) await this.assets.put({id:"app-background",kind:"background",file});
      if (sequence!==this.sequence) { URL.revokeObjectURL(url);return; }
      if (this.url) URL.revokeObjectURL(this.url); this.url=url;
      if (persist) await this.update({imagePath:file.name});
      this.apply();
    } catch (error) { URL.revokeObjectURL(url);throw error; }
  }
  async clear() {
    ++this.sequence;await this.assets.delete("app-background");
    if (this.url) URL.revokeObjectURL(this.url); this.url=null;
    await this.update({imagePath:""});this.apply();
  }
  apply() {
    const settings=this.viewState.preferences.appBackground || {}, active=Boolean(settings.enabled && this.url);
    this.root.classList.toggle("app-background-active",active);
    this.root.style.setProperty("--app-background-image",this.url?`url("${this.url}")`:"none");
    this.root.style.setProperty("--app-background-opacity",settings.opacity ?? .2);
    this.root.style.setProperty("--app-background-blur",`${this.viewState.preferences.blurMaterialsEnabled===false?0:settings.blur || 0}px`);
    this.root.style.setProperty("--app-background-size",({stretch:"100% 100%",center:"auto",repeat:"auto"})[settings.sizeMode] || settings.sizeMode || "cover");
    this.root.style.setProperty("--app-background-repeat",settings.sizeMode==="repeat"?"repeat":"no-repeat");
    this.root.style.setProperty("--app-background-position",(settings.position || "center").replaceAll("_"," "));
    const overlays=settings.overlays || {}, light=["light","legacy_light"].includes(this.viewState.activeThemeToken);
    const colorRoles={"surface":settings.panelAlpha ?? 200,"panel":settings.panelAlpha ?? 200,
      "activity-bar":overlays[light?"toolbar_light":"toolbar_dark"] ?? (light?210:200),
      "editor-tab-strip":overlays[light?"editor_header_light":"editor_header_dark"] ?? (light?200:190),
      "control":overlays[light?"input_light":"input_dark"] ?? 200};
    const base=getComputedStyle(this.root.ownerDocument.documentElement);
    for (const [role,alpha] of Object.entries(colorRoles)) {
      const name=`--background-${role}`;
      if (active) this.root.style.setProperty(name,`color-mix(in srgb, ${base.getPropertyValue(name).trim()} ${alpha/255*100}%, transparent)`);
      else this.root.style.removeProperty(name);
    }
  }
  destroy() { ++this.sequence;this.viewState.removeEventListener("change",this.changed);if(this.url)URL.revokeObjectURL(this.url); }
}
