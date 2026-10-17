export class UserFonts {
  constructor(preview,assets) { this.preview=preview;this.assets=assets;this.fonts=new Map();this.faces=new Map();this.loads=new Map(); }
  async load(file) {
    const font=await this.preview.importFont(file,file.name);
    if (this.fonts.has(font.path)) return this.fonts.get(font.path);
    if (this.loads.has(font.path)) return this.loads.get(font.path);
    const loading=this.loadFace(font,file);this.loads.set(font.path,loading);
    try{return await loading;}finally{this.loads.delete(font.path);}
  }
  async loadFace(font,file) {
    const cssFamily=`MiaCode-user-${font.sha256}`;
    const face=await new FontFace(cssFamily,await file.arrayBuffer()).load();
    if(this.destroyed)throw new DOMException("字体库关闭","AbortError");
    document.fonts.add(face);this.faces.set(font.path,face);
    const result={...font,cssFamily};this.fonts.set(font.path,result);return result;
  }
  async import(file) {
    const font=await this.load(file);
    await this.assets.put({id:`font:${font.path}`,kind:"font",file,...font});return font;
  }
  async restore() { for (const record of await this.assets.fonts()) await this.load(record.file);return this.list(); }
  list() { return [...this.fonts.values()].sort((left,right)=>left.family.localeCompare(right.family)); }
  destroy() { this.destroyed=true;for(const face of this.faces.values())document.fonts.delete(face);this.faces.clear();this.fonts.clear(); }
}
