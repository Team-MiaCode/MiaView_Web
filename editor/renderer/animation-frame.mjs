export function nextAnimationFrame(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => { cancelAnimationFrame(id); reject(signal.reason); };
    const id = requestAnimationFrame(now => {
      signal.removeEventListener("abort", cancel); resolve(now);
    });
    signal.addEventListener("abort", cancel, { once: true });
  });
}
