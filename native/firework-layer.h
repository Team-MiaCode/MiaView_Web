#pragma once

namespace miaview::firework {

// One preview window per WebAssembly instance. Readiness is published only
// after a frame using the real firework material and textures was submitted.
bool ready();

}  // namespace miaview::firework
