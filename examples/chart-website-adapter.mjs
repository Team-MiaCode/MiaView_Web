// Example adapter for a host whose charts use /api/files/<id>/.
// The host owns metadata, authentication and play counters.
export async function loadWebsiteChart({ id, bgExt, hasVideo, difficulty }, signal, base = location.origin) {
  const resource = name => new URL(`/api/files/${encodeURIComponent(id)}/${name}`, base);
  const blob = async name => {
    const response = await fetch(resource(name), { signal });
    if (!response.ok) throw new Error(`${name} 加载失败（HTTP ${response.status}）`);
    return response.blob();
  };
  const [maidata, audio, cover] = await Promise.all([
    blob("maidata.txt"),
    blob("track.mp3"),
    bgExt ? blob(`bg.${encodeURIComponent(bgExt)}`) : undefined,
  ]);
  return { maidata, audio, cover, difficulty, video: hasVideo ? resource("bg.mp4").href : undefined };
}
