export function wavHeader(sampleCount, sampleRate = 48000) {
  const buffer = new ArrayBuffer(44), data = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((letter, index) => data.setUint8(offset + index, letter.charCodeAt(0)));
  text(0, "RIFF"); data.setUint32(4, 36 + sampleCount * 4, true); text(8, "WAVE"); text(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true);
  data.setUint32(24, sampleRate, true); data.setUint32(28, sampleRate * 4, true);
  data.setUint16(32, 4, true); data.setUint16(34, 16, true); text(36, "data"); data.setUint32(40, sampleCount * 4, true);
  return buffer;
}

export function wavPcm(buffer) {
  const bytes = new ArrayBuffer(buffer.length * 4), data = new DataView(bytes);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let sample = 0; sample < buffer.length; sample++) for (let channel = 0; channel < 2; channel++) {
    const value = Math.max(-1, Math.min(1, (channel ? right : left)[sample]));
    data.setInt16(sample * 4 + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
