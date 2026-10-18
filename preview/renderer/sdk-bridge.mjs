import {
  SDK_PROTOCOL,
  FRAME_SOURCE,
  trustedRequest,
  httpUrl,
} from "./protocol.mjs";

export function attachSdkBridge(engine, controller) {
  const originValue = new URLSearchParams(location.search).get("hostOrigin");
  // Only SDK-created embeds include the exact host origin.
  if (!originValue || window.parent === window) return;
  let origin;
  try {
    origin = new URL(httpUrl(originValue)).origin;
  } catch {
    return;
  }
  if (origin !== originValue) return;
  let sessionId = null,
    disposed = false,
    queue = Promise.resolve();
  let playbackRequest = 0;
  const send = (type, payload, extra = {}) => {
    if (!sessionId || disposed) return;
    const identity = engine.identity();
    window.parent.postMessage(
      {
        source: FRAME_SOURCE,
        protocolVersion: SDK_PROTOCOL,
        sessionId,
        playerVersion: identity?.version,
        sourceRevision: identity?.sourceRevision,
        type,
        payload,
        ...extra,
      },
      origin,
    );
  };
  const unsubscribe = controller.events((type, payload) => send(type, payload));
  async function execute(message) {
    if (message.type !== "initialize")
      return controller.execute(message.type, message.payload);
    await engine.boot;
    const identity = engine.identity();
    if (message.payload?.playerVersion !== identity.version ||
        message.payload?.sourceRevision !== identity.sourceRevision)
      throw new Error("Renderer build identity mismatch");
    send("ready", { playerVersion: identity.version, sourceRevision: identity.sourceRevision });
    return engine.state();
  }
  const receive = (event) => {
    const message = trustedRequest(event, window.parent, origin, sessionId, controller.commands);
    if (!message || disposed) return;
    if (!sessionId) {
      if (message.type !== "initialize") return;
      sessionId = message.sessionId;
    }
    const request = message.type === "pause" ? ++playbackRequest : playbackRequest;
    const next = (message.type === "pause" ? Promise.resolve() : queue).then(async () => {
      try {
        send("response", null, {
          requestId: message.requestId,
          ok: true,
          value: (message.type === "play" || message.type === "restart") && request !== playbackRequest ? engine.state() : await execute(message),
        });
      } catch (error) {
        if (disposed) return;
        if (message.type === "load" || message.type === "selectDifficulty")
          engine.fail(error);
        send("response", null, {
          requestId: message.requestId,
          ok: false,
          error: { message: error.message ?? "Preview command failed" },
        });
      }
    });
    if (message.type !== "getAnalysis" && message.type !== "pause") queue = next;
  };
  window.addEventListener("message", receive);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("message", receive);
    },
    { once: true },
  );
}
