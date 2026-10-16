export async function observeAudioDecoding(page, sampleRate) {
  await page.addInitScript(sampleRate => {
    window.audioDecodes = [];
    const Context = window.AudioContext;
    if (sampleRate) window.AudioContext = class extends Context {
      constructor(options) { super({ ...options, sampleRate }); }
    };
    const decode = Context.prototype.decodeAudioData;
    Context.prototype.decodeAudioData = function (bytes, ...args) {
      const byteSize = bytes.byteLength;
      return decode.call(this, bytes, ...args).then(buffer => {
        audioDecodes.push({ byteSize, duration: buffer.duration, frames: buffer.length, sampleRate: buffer.sampleRate });
        return buffer;
      });
    };
  }, sampleRate);
}
