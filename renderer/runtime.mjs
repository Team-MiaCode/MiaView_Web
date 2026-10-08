export const TARGET_FPS = 60;
export const PLAYER_SOURCE = "MiaCodeWebGL";
export const PROTOCOL_VERSION = 1;

const sha256 = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");

// Disk only: don't retain a second in-memory copy of videos or engine bytes.
// Cache failures (private browsing/quota) must never prevent playback.
export class PreviewByteCache {
  constructor(name, maxBytes, maxEntries = 64, storage = globalThis.caches) {
    this.name = name;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.storage = storage;
    this.writes = Promise.resolve();
  }
  key(hash, size, scope = "engine") {
    return `https://miacode-cache.invalid/${encodeURIComponent(scope)}/${hash}/${size}`;
  }
  async read(hash, size, scope) {
    try {
      const cache = await this.storage?.open(this.name);
      if (!cache) return null;
      const key = this.key(hash, size, scope);
      const response = await cache.match(key);
      if (!response) return null;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== size || (await sha256(bytes)) !== hash) {
        await cache.delete(key);
        return null;
      }
      return bytes;
    } catch {
      return null;
    }
  }
  async write(hash, bytes, scope) {
    if (!this.storage || bytes.byteLength > this.maxBytes) return;
    const write = async () => {
      const cache = await this.storage.open(this.name);
      const key = this.key(hash, bytes.byteLength, scope);
      await cache.delete(key);
      const entries = await cache.keys();
      let total = bytes.byteLength;
      const sizes = await Promise.all(
        entries.map(async (entry) => {
          const response = await cache.match(entry);
          return (
            Number(response?.headers.get("x-miacode-size")) || this.maxBytes
          );
        }),
      );
      total += sizes.reduce((sum, size) => sum + size, 0);
      while (
        entries.length &&
        (total > this.maxBytes || entries.length >= this.maxEntries)
      ) {
        const entry = entries.shift();
        total -= sizes.shift();
        await cache.delete(entry);
      }
      await cache.put(
        key,
        new Response(bytes, {
          headers: { "x-miacode-size": String(bytes.byteLength) },
        }),
      );
    };
    this.writes = this.writes.then(write).catch(() => {});
    await this.writes;
  }
}

const engineCache = new PreviewByteCache(
  "miacode-engine-v1",
  64 * 1024 * 1024,
  2,
);
const assetCache = new PreviewByteCache("miacode-assets-v1", 128 * 1024 * 1024);

// Bind glue and WASM to one inventory. Mixed cached builds can have different
// minified export/import indices and trap even before the Qt window starts.
export async function loadPreviewRuntime(
  baseUrl,
  fetcher = fetch,
  document = globalThis.document,
  compiler = WebAssembly,
  cache = engineCache,
) {
  const read = async (name) => {
    const response = await fetcher(new URL(name, baseUrl), {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("播放器文件加载失败，请刷新页面");
    return response;
  };
  const [identityBytes, manifest] = await Promise.all([
    read("build-identity.json").then((response) => response.arrayBuffer()),
    read("artifact-manifest.json").then((response) => response.json()),
  ]);
  const identity = JSON.parse(new TextDecoder().decode(identityBytes));
  const mismatch = () => new Error("播放器文件版本不一致，请刷新页面");
  if (
    identity.upstream !== PLAYER_SOURCE ||
    identity.protocolVersion !== PROTOCOL_VERSION ||
    typeof identity.version !== "string" ||
    !identity.version ||
    !Array.isArray(manifest.files)
  )
    throw mismatch();
  const asset = (path) => {
    const entries = manifest.files.filter((file) => file?.path === path);
    if (entries.length !== 1 || !/^[a-f0-9]{64}$/.test(entries[0].sha256))
      throw mismatch();
    const url = new URL(path, baseUrl);
    url.searchParams.set("build", identity.version);
    const integrity =
      "sha256-" +
      btoa(
        String.fromCharCode(
          ...entries[0].sha256.match(/../g).map((byte) => parseInt(byte, 16)),
        ),
      );
    return {
      url,
      integrity,
      sha256: entries[0].sha256,
      byteSize: entries[0].byteSize,
    };
  };
  const identityHash = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", identityBytes)),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (identityHash !== asset("build-identity.json").sha256) throw mismatch();
  const glue = asset("miacode-preview.js"),
    wasm = asset("miacode-preview.wasm");
  // Download glue alongside WASM, but execute it only after WASM validation.
  // The subsequent script request reuses the matching integrity-bearing preload.
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "script";
  preload.href = glue.url.href;
  preload.integrity = glue.integrity;
  preload.crossOrigin = "anonymous";
  document.head.append(preload);
  // Fetch's integrity check rejects the wrong binary before instantiation.
  let wasmModule;
  try {
    const cached = Number.isSafeInteger(wasm.byteSize)
      ? await cache.read(wasm.sha256, wasm.byteSize)
      : null;
    const response = cached
      ? new Response(cached, {
          headers: { "content-type": "application/wasm" },
        })
      : await fetcher(wasm.url, {
          cache: "force-cache",
          integrity: wasm.integrity,
        });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = response.headers.get("content-type")?.split(";")[0].trim();
    // Keep only the bounded disk copy; don't persist compiled/native instances.
    const saved =
      !cached && Number.isSafeInteger(wasm.byteSize) ? response.clone() : null;
    wasmModule =
      typeof compiler.compileStreaming === "function" &&
      mime === "application/wasm"
        ? await compiler.compileStreaming(response)
        : await compiler.compile(await response.arrayBuffer());
    if (saved) {
      const bytes = await saved.arrayBuffer();
      if (
        bytes.byteLength === wasm.byteSize &&
        (await sha256(bytes)) === wasm.sha256
      )
        await cache.write(wasm.sha256, bytes);
    }
  } catch (cause) {
    preload.remove();
    throw new Error("播放器文件加载或校验失败，请刷新页面", { cause });
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = glue.url.href;
    script.integrity = glue.integrity;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      preload.remove();
      resolve();
    };
    script.onerror = () => {
      preload.remove();
      script.remove();
      reject(mismatch());
    };
    document.head.append(script);
  });
  const entryFunction = document.defaultView.miacode_preview_entry;
  if (typeof entryFunction !== "function") throw mismatch();
  return { identity, wasmModule, entryFunction };
}

// Track decoded/presented frames, not the continuously advancing media clock.
// The render loop consumes one dirty flag, so delayed frames never accumulate.
export class PreviewVideoFrames {
  constructor(video) {
    this.video = video;
    this.epoch = 0;
    this.usesCallback =
      typeof video.requestVideoFrameCallback === "function" &&
      typeof video.cancelVideoFrameCallback === "function";
    this.reset();
    const invalidate = () => {
      this.dirty = true;
    };
    video.addEventListener("loadeddata", invalidate);
    video.addEventListener("seeked", invalidate);
  }
  reset() {
    ++this.epoch;
    if (this.handle != null) this.video.cancelVideoFrameCallback(this.handle);
    this.handle = null;
    this.dirty = false;
    this.lastFrame = -1;
    this.lastTime = -1;
  }
  start() {
    this.reset();
    if (!this.usesCallback) return;
    const epoch = this.epoch;
    const presented = () => {
      if (epoch !== this.epoch) return;
      this.dirty = true;
      this.handle = this.video.requestVideoFrameCallback(presented);
    };
    this.handle = this.video.requestVideoFrameCallback(presented);
  }
  frameCount() {
    const count =
      this.video.getVideoPlaybackQuality?.().totalVideoFrames ??
      this.video.webkitDecodedFrameCount;
    return Number.isFinite(count) ? count : null;
  }
  needsUpload() {
    if (this.video.readyState < 2 || this.video.seeking) return false;
    if (this.usesCallback) return this.dirty;
    const count = this.frameCount();
    return (
      this.dirty ||
      (count !== null
        ? count !== this.lastFrame
        : this.video.currentTime !== this.lastTime)
    );
  }
  consume() {
    this.dirty = false;
    this.lastFrame = this.frameCount();
    this.lastTime = this.video.currentTime;
  }
}

export function decodeMaidata(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
  }
}

export function trustedHostMessage(event, parent, origin, sessionId) {
  const message = event.data;
  if (
    event.source !== parent ||
    event.origin !== origin ||
    !message ||
    message.source !== "maiChart" ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      message.sessionId ?? "",
    )
  )
    return null;
  if (sessionId && message.sessionId !== sessionId) return null;
  if (
    !["initialize", "load", "pause", "resume", "reload", "destroy"].includes(
      message.type,
    )
  )
    return null;
  if (message.type === "load") {
    const payload = message.payload;
    const manifest = payload?.manifest;
    if (
      !manifest ||
      manifest.protocolVersion !== 1 ||
      manifest.player?.upstream !== PLAYER_SOURCE ||
      manifest.player.messageProtocolVersion !== PROTOCOL_VERSION ||
      !manifest.maidata ||
      !Array.isArray(manifest.assets) ||
      !(
        payload.chartIndex === null ||
        (Number.isInteger(payload.chartIndex) &&
          payload.chartIndex >= 1 &&
          payload.chartIndex <= 7)
      )
    )
      return null;
  }
  return message;
}

export async function fetchVerified(
  resource,
  signal,
  fetcher = fetch,
  cache = assetCache,
) {
  const url = new URL(resource.url);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !Number.isSafeInteger(resource.byteSize) ||
    resource.byteSize <= 0 ||
    !/^[a-f0-9]{64}$/.test(resource.sha256)
  )
    throw new Error("资源描述无效");
  signal?.throwIfAborted();
  // Only a current, authorized manifest can opt website assets into disk reuse.
  // No signed URL, token, manifest or account information is stored on disk.
  const cacheable =
    typeof resource.cacheScope === "string" &&
    resource.cacheScope &&
    Number.isFinite(Date.parse(resource.expiresAt)) &&
    Date.parse(resource.expiresAt) > Date.now();
  if (cacheable) {
    const cached = await cache.read(
      resource.sha256,
      resource.byteSize,
      resource.cacheScope,
    );
    signal?.throwIfAborted();
    if (cached) return cached;
  }
  const response = await fetcher(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("资源读取失败，请重新加载谱面");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== resource.byteSize)
    throw new Error("资源大小不匹配，请重新加载谱面");
  const sha = await sha256(bytes);
  if (sha !== resource.sha256) throw new Error("资源校验失败，请重新加载谱面");
  signal?.throwIfAborted();
  if (cacheable) await cache.write(resource.sha256, bytes, resource.cacheScope);
  return bytes;
}

// Exactly one chart's prepared media. Difficulty changes reuse decoded music
// and verified PV bytes; switching charts/destroying drops the old reference.
export class PreviewMediaCache {
  clear() {
    this.entry = null;
  }
  load(resources, context, readBytes, signal) {
    const kinds = ["maidata", "audio", "cover", "video"];
    const same = (a, b) =>
      a === b ||
      (a &&
        b &&
        typeof a.url === "string" &&
        a.url === b.url &&
        a.sha256 === b.sha256 &&
        a.byteSize === b.byteSize &&
        a.cacheScope === b.cacheScope);
    if (
      this.entry &&
      (this.entry.complete || !this.entry.signal?.aborted) &&
      kinds.every((kind) => same(resources[kind], this.entry.resources[kind]))
    )
      return this.entry;
    const read = (kind) =>
      resources[kind]
        ? readBytes(resources[kind], signal)
        : Promise.resolve(null);
    let entry;
    const text = read("maidata").then((bytes) => {
      const decoded = decodeMaidata(bytes);
      entry.textReady = true;
      entry.complete = !!entry.mediaReady;
      return decoded;
    });
    const music = Promise.all([
      read("audio").then((bytes) =>
        bytes ? context.decodeAudioData(bytes) : null,
      ),
      read("cover"),
    ]).then(([track, coverBytes]) => ({ track, coverBytes }));
    const video = read("video").then((videoBytes) =>
      videoBytes
        ? new Blob([videoBytes], {
            type:
              resources.video.contentType ??
              resources.video.type ??
              "video/mp4",
          })
        : null,
    );
    const media = Promise.all([music, video]).then(
      ([{ track, coverBytes }, videoBlob]) => {
        entry.mediaReady = true;
        entry.complete = !!entry.textReady;
        return { track, coverBytes, videoBlob };
      },
    );
    entry = {
      resources: { ...resources },
      text,
      music,
      video,
      media,
      signal,
      complete: false,
    };
    this.entry = entry;
    // Handle both branches even if parsing fails before the media is awaited.
    for (const promise of [text, media])
      void promise.catch(() => {
        if (this.entry === entry) this.clear();
      });
    return entry;
  }
}

export function lowerBound(events, second, field = "second") {
  let start = 0,
    end = events.length;
  while (start < end) {
    const mid = (start + end) >>> 1;
    if (events[mid][field] < second) start = mid + 1;
    else end = mid;
  }
  return start;
}

// AudioContext is the clock authority, so display, song, and scheduled judgments
// remain aligned even if a render frame is delayed. Pausing stops all sources.
export class PreviewAudio {
  constructor(context) {
    this.context = context;
    this.buffers = new Map();
    this.voices = new Set();
    this.events = [];
    this.segments = [];
    this.offset = 0;
    this.duration = 0;
    this.playing = false;
  }
  currentSecond() {
    return this.playing
      ? Math.max(
          this.offset,
          Math.min(
            this.duration,
            this.offset + this.context.currentTime - this.startedAt,
          ),
        )
      : this.offset;
  }
  stopSources() {
    for (const source of this.voices) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.voices.clear();
  }
  pause() {
    this.offset = this.currentSecond();
    this.playing = false;
    this.stopSources();
  }
  seek(second) {
    const resume = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, second));
    if (resume) this.start();
  }
  start() {
    if (this.playing) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.startedAt = this.context.currentTime + 0.03;
    this.playing = true;
    this.eventIndex = lowerBound(this.events, this.offset);
    this.segmentIndex = lowerBound(this.segments, this.offset, "endSecond");
    if (this.track && this.offset < this.track.duration)
      this.voice(
        this.track,
        this.offset,
        this.track.duration,
        this.offset,
        0.3,
      );
    this.schedule();
  }
  voice(buffer, start, end, sourceOffset, gain, loop = false) {
    if (
      !buffer ||
      end <= this.offset ||
      (!loop && sourceOffset >= buffer.duration)
    )
      return;
    const actualStart = Math.max(start, this.offset, this.currentSecond());
    const when = this.startedAt + actualStart - this.offset;
    const offset = sourceOffset + actualStart - start;
    const source = this.context.createBufferSource();
    const volume = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    volume.gain.value = gain;
    source.connect(volume).connect(this.context.destination);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      volume.disconnect();
    };
    source.start(
      Math.max(this.context.currentTime, when),
      loop ? offset % buffer.duration : offset,
    );
    if (Number.isFinite(end))
      source.stop(
        Math.max(this.context.currentTime, this.startedAt + end - this.offset),
      );
  }
  schedule() {
    if (!this.playing) return;
    const until = this.currentSecond() + 0.12;
    while (
      this.eventIndex < this.events.length &&
      this.events[this.eventIndex].second <= until
    ) {
      const event = this.events[this.eventIndex++];
      const end =
        event.nextSameKindSecond > event.second
          ? event.nextSameKindSecond
          : Infinity;
      this.voice(
        this.buffers.get(event.file),
        event.second,
        end,
        0,
        event.gain,
      );
    }
    while (
      this.segmentIndex < this.segments.length &&
      this.segments[this.segmentIndex].startSecond <= until
    ) {
      const span = this.segments[this.segmentIndex++];
      this.voice(
        this.buffers.get("touch_Hold_riser.wav") ??
          this.buffers.get("touchHold_riser.wav"),
        span.startSecond,
        span.endSecond,
        span.sourceOffsetSecond,
        0.09,
        true,
      );
    }
  }
  reset() {
    this.pause();
    this.track = null;
    this.events = [];
    this.segments = [];
    this.offset = 0;
    this.duration = 0;
  }
}
