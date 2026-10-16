const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
async function checksum(blob) {
  let crc = 0xffffffff;
  for await (const chunk of blob.stream()) for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size, fields, name) {
  const bytes = new Uint8Array(size + name.length), view = new DataView(bytes.buffer);
  for (const [offset, width, value] of fields) view[width === 2 ? "setUint16" : "setUint32"](offset, value, true);
  bytes.set(name, size); return bytes;
}
// Media is already encoded. Store its Blob parts in ZIP without transcoding.
export async function projectArchive(files) {
  const parts = [], directory = [], encoder = new TextEncoder();
  let offset = 0, count = 0;
  for (const [path, file] of files) {
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("工程文件路径无效");
    const name = encoder.encode(path);
    if (file.size > 0xffffffff || name.length > 0xffff || offset > 0xffffffff || ++count > 0xffff) throw new Error("工程文件超出 ZIP 格式范围");
    const crc = await checksum(file), date = new Date(file.lastModified || Date.now());
    const time = date.getHours() << 11 | date.getMinutes() << 5 | date.getSeconds() >> 1;
    const day = Math.max(0, Math.min(127, date.getFullYear() - 1980)) << 9 | (date.getMonth() + 1) << 5 | date.getDate();
    const local = header(30, [[0,4,0x04034b50],[4,2,20],[6,2,0x800],[10,2,time],[12,2,day],[14,4,crc],[18,4,file.size],[22,4,file.size],[26,2,name.length]], name);
    directory.push(header(46, [[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x800],[12,2,time],[14,2,day],[16,4,crc],[20,4,file.size],[24,4,file.size],[28,2,name.length],[42,4,offset]], name));
    parts.push(local, file); offset += local.length + file.size;
  }
  const centralSize = directory.reduce((size, entry) => size + entry.length, 0);
  if (offset + centralSize > 0xffffffff) throw new Error("工程文件超出 ZIP 格式范围");
  const end = header(22, [[0,4,0x06054b50],[8,2,count],[10,2,count],[12,4,centralSize],[16,4,offset]], new Uint8Array());
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
