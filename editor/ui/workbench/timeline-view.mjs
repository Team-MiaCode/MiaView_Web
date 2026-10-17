import { PreviewFrameLimiter } from "../../renderer/frame-rate.mjs";
import { frameRateForMode } from "../../renderer/performance-settings.mjs";
import { timelinePlayheadX, timelineCenteredScroll } from "./timeline-playback.mjs";

const namespace = "http://www.w3.org/2000/svg";
function svg(tag, attributes, text) {
  const node = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export class TimelineView {
  constructor(command) {
    this.command = command;
    this.root = svg("svg", { class: "timeline-view", role: "img", "aria-label": "时间轴", tabindex: 0 });
    this.state = null;
    this.frameLimiter = new PreviewFrameLimiter(60);
    this.followProgressEnabled = true;
    this.abort = new AbortController();
    this.root.ownerDocument.addEventListener("visibilitychange", () => this.animate(), { signal: this.abort.signal });
    this.clipId = `timeline-${crypto.randomUUID()}`;
    this.resize = new ResizeObserver(() => {
      const bounds = this.root.getBoundingClientRect();
      this.visible = bounds.width > 0 && bounds.height > 0;
      this.animate();
      if (bounds.width && bounds.height) command("timeline.viewport", { width: Math.round(bounds.width), height: Math.round(bounds.height) });
    });
    this.resize.observe(this.root);
    this.root.addEventListener("pointerdown", event => {
      const bounds = this.root.getBoundingClientRect();
      command("timeline.navigateAtPoint", { x: event.clientX - bounds.left, y: event.clientY - bounds.top, width: bounds.width, height: bounds.height,
        horizontalScrollValue: this.scrollValue });
    });
    this.root.addEventListener("wheel", event => {
      event.preventDefault();
      command("timeline.scroll", { delta: event.deltaY || event.deltaX, horizontalScrollValue: this.scrollValue });
    }, { passive: false });
  }
  setState(state) { if (this.state === state) return; this.state = state; this.draw(); }
  draw() {
    const { width, height } = this.root.getBoundingClientRect();
    if (!width || !height) return;
    this.root.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const state = this.state;
    if (!state) { this.root.replaceChildren(); return; }
    this.worlds = []; this.scrollValue = state.horizontalScrollValue;
    const rectangle = item => svg("rect", { ...item.rect, fill: item.color });
    const line = item => svg("line", { x1: item.start.x, y1: item.start.y, x2: item.end.x, y2: item.end.y, stroke: item.color, "stroke-width": item.width, "shape-rendering": "crispEdges" });
    const triangle = item => svg("polygon", { points: `${item.a.x},${item.a.y} ${item.b.x},${item.b.y} ${item.c.x},${item.c.y}`, fill: item.color });
    const label = item => svg("text", { x: item.topLeft.x + 2, y: item.topLeft.y + 1 + item.font.ascent, fill: item.color, "font-family": item.font.family, "font-size": item.font.pixelSize }, item.text);
    const image = (key, rect) => svg("image", { ...rect, href: state.images[key].url, preserveAspectRatio: "none" });
    const sprite = item => {
      const size = state.images[item.imageKey];
      const node = image(item.imageKey, { x: Math.round(item.center.x) - size.width / 2, y: Math.round(item.center.y) - size.height / 2, width: size.width, height: size.height });
      node.setAttribute("data-sprite", item.spriteType);
      return node;
    };
    const defs = svg("defs", {});
    for (const [key, bounds] of [["body", { x: state.timelineLeft, y: state.timelineTop, width: Math.max(0, width - state.timelineLeft), height: state.timelineHeight }],
      ["header", { x: state.timelineLeft, y: 0, width: Math.max(0, width - state.timelineLeft), height: state.timelineTop }]]) {
      const clip = svg("clipPath", { id: `${this.clipId}-${key}` });
      clip.append(svg("rect", bounds)); defs.append(clip);
    }
    const worldGroup = (key, ...children) => {
      const clip = svg("g", { "clip-path": `url(#${this.clipId}-${key})` });
      const world = svg("g", { transform: `translate(${-state.horizontalScrollValue} 0)` });
      this.worlds.push(world);
      world.append(...children); clip.append(world); return clip;
    };
    const nodes = [defs, ...state.baseBackgroundRects.map(rectangle), ...state.laneOverlayRects.map(rectangle)];
    nodes.push(worldGroup("header", ...state.headerLabels.map(label)));
    nodes.push(worldGroup("body", ...state.gridLines.map(line)));
    const waveform = this.waveform(state.waveformBars);
    if (waveform) nodes.push(worldGroup("body", waveform));
    const notes = [];
    for (const item of state.fireworkBands) {
      const node = rectangle(item); node.setAttribute("opacity", .55); notes.push(node);
    }
    notes.push(...state.trackLines.map(line), ...state.trackSprites.map(sprite));
    for (const span of state.holdSpans) {
      const left = state.images[span.leftKey], right = state.images[span.rightKey], body = state.images[span.bodyKey];
      const top = span.rowTop + (span.laneHeight - left.height) / 2;
      notes.push(image(span.bodyKey, { x: span.startX, y: top, width: Math.max(0, span.endX - span.startX), height: body.height }),
        image(span.leftKey, { x: span.startX - left.width, y: top, width: left.width, height: left.height }),
        image(span.rightKey, { x: span.endX, y: top, width: right.width, height: right.height }));
    }
    notes.push(...state.touchHoldLines.map(line), ...state.noteSprites.map(sprite));
    for (const item of state.muriDots) {
      const box = item.rect;
      const attributes = { fill: item.fillColor, stroke: item.strokeColor, "stroke-width": item.strokeWidth };
      const node = item.shape === 0 ? svg("ellipse", { ...attributes, cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: (box.width - 1) / 2, ry: (box.height - 1) / 2 })
        : item.shape === 1 ? svg("polygon", { ...attributes, points: `${box.x + box.width / 2},${box.y} ${box.x + box.width},${box.y + box.height / 2} ${box.x + box.width / 2},${box.y + box.height} ${box.x},${box.y + box.height / 2}` })
        : svg("rect", { ...box, ...attributes, rx: item.radius });
      if (item.tooltipText) node.append(svg("title", {}, item.tooltipText));
      notes.push(node);
    }
    nodes.push(worldGroup("body", ...notes), ...state.frameRects.map(rectangle), ...state.frameLines.map(line), ...state.laneLabels.map(label));
    const markers = state.headerMarkers.map(triangle);
    if (state.hasEntryMarker) markers.push(triangle(state.entryMarker));
    if (state.hasCursorMarker) markers.push(triangle(state.cursorMarker));
    nodes.push(worldGroup("header", ...markers));
    const overlays = [];
    this.playhead = null;
    for (const key of ["playheadLine", "cursorLine", "dragCenterLine"]) {
      if (state[`has${key[0].toUpperCase()}${key.slice(1)}`]) {
        const node = line(state[key]); node.setAttribute("data-overlay", key); overlays.push(node);
        if (key === "playheadLine") this.playhead = node;
      }
    }
    nodes.push(worldGroup("body", ...overlays));
    this.root.replaceChildren(...nodes);
    if (this.clock) this.updatePlayhead(this.playbackSecond());
  }
  waveform(bars) {
    if (!bars.length) return null;
    const pixels = new Map();
    for (const { rect, color } of bars) {
      for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.width); x++) {
        const value = pixels.get(x);
        if (value) { value.top = Math.min(value.top, rect.y); value.bottom = Math.max(value.bottom, rect.y + rect.height); }
        else pixels.set(x, { top: rect.y, bottom: rect.y + rect.height, color });
      }
    }
    const columns = [...pixels].sort(([a], [b]) => a - b);
    const top = columns.map(([x, value]) => `${x + .5},${value.top}`).join(" L");
    const bottom = [...columns].reverse().map(([x, value]) => `${x + .5},${value.bottom}`).join(" L");
    return svg("path", { d: `M${top} L${bottom} Z`, fill: columns[0][1].color, "data-waveform": "true" });
  }
  updatePlayhead(second, center = this.followProgressEnabled && this.clock?.playing) {
    if (!this.state || !this.playhead) return;
    const state = this.state;
    const x = timelinePlayheadX(state, second);
    this.playhead.setAttribute("x1", x); this.playhead.setAttribute("x2", x);
    if (center) {
      this.scrollValue = timelineCenteredScroll(state, second);
      for (const world of this.worlds) world.setAttribute("transform", `translate(${-this.scrollValue} 0)`);
      // Native scene requests include a viewport of cull padding on both sides.
      if (!this.refreshing && Math.abs(this.scrollValue - state.horizontalScrollValue) > state.viewportSize.width / 2) {
        this.refreshing = true;
        void Promise.resolve(this.command("timeline.playbackViewport", { horizontalScrollValue: this.scrollValue }))
          .then(() => { this.refreshing = false; }, () => { this.refreshing = false; });
      }
    }
  }
  playbackSecond(now = performance.now()) {
    return Math.min(this.clock.duration, this.clock.currentTime + (this.clock.playing ? (now - this.clock.observedAt) / 1000 * this.clock.rate : 0));
  }
  setFrameRateMode(mode) { this.frameLimiter = new PreviewFrameLimiter(frameRateForMode(mode)); }
  setPlayback(state) {
    const moved = this.clock?.currentTime !== state.currentTime;
    this.clock = { ...this.clock, ...state, observedAt: performance.now() };
    if (!state.playing) this.updatePlayhead(state.currentTime, this.followProgressEnabled && moved);
    this.animate();
  }
  animate() {
    if (!this.clock?.playing || !this.visible || this.root.ownerDocument.hidden) {
      cancelAnimationFrame(this.animation); this.animation = null; return;
    }
    if (this.animation != null) return;
    const frame = now => {
      if (this.frameLimiter.accept(now)) this.updatePlayhead(this.playbackSecond(now));
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
  }
  destroy() { cancelAnimationFrame(this.animation); this.abort.abort(); this.resize.disconnect(); }
}
