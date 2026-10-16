export async function observeVideoDecoders(page) {
  await page.addInitScript(() => {
    window.decoderConfigurations = []; window.decoders = [];
    window.videoFrames = new Set();
    const Frame = window.VideoFrame;
    const track = value => {
      if (Frame && value instanceof Frame) videoFrames.add(value);
      else if (value && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) for (const item of Object.values(value)) track(item);
    };
    if (Frame) {
      window.VideoFrame = new Proxy(Frame, { construct(target, args) { const frame = Reflect.construct(target, args); videoFrames.add(frame); return frame; } });
      const clone = Frame.prototype.clone, close = Frame.prototype.close;
      Frame.prototype.clone = function (...args) { const frame = clone.apply(this, args); videoFrames.add(frame); return frame; };
      Frame.prototype.close = function (...args) { videoFrames.delete(this); return close.apply(this, args); };
    }
    const WorkerConstructor = window.Worker;
    if (WorkerConstructor) window.Worker = new Proxy(WorkerConstructor, { construct(target, args) {
      const worker = Reflect.construct(target, args); worker.addEventListener("message", event => track(event.data)); return worker;
    } });
    const Decoder = window.VideoDecoder;
    if (Decoder) window.VideoDecoder = class extends Decoder {
      constructor(options) {
        const output = options.output;
        super({ ...options, output: frame => { videoFrames.add(frame); output(frame); } }); window.decoders.push(this);
      }
      configure(config) { window.decoderConfigurations.push(config.hardwareAcceleration); super.configure(config); }
    };
  });
}

export function decoderSnapshot() {
  for (const frame of globalThis.videoFrames) if (!frame.codedWidth) globalThis.videoFrames.delete(frame);
  return { configurations: globalThis.decoderConfigurations, active: globalThis.decoders.filter(decoder => decoder.state !== "closed").length,
    frames: globalThis.videoFrames.size };
}
