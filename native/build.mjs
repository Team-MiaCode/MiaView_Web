import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const qtRoot = resolve(process.env.MIACODE_QT_ROOT ?? "/tmp/miacode-qt/6.8.3");
const emsdk = resolve(process.env.MIACODE_EMSDK_ROOT ?? "/tmp/miacode-emsdk");
const build = resolve(
  process.env.MIACODE_BUILD_DIR ?? join(here, "build-release"),
);
const publicRoot = resolve(here, "../renderer");
if (
  !existsSync(
    join(qtRoot, "wasm_singlethread/lib/cmake/Qt6/qt.toolchain.cmake"),
  )
)
  throw new Error(
    "Install Qt 6.8.3 wasm_singlethread and matching desktop host tools first",
  );
const env = {
  ...process.env,
  EMSDK: emsdk,
  PATH: `${join(emsdk, "upstream/emscripten")}:${process.env.PATH}`,
};
const compilerVersion = spawnSync(
  join(emsdk, "upstream/emscripten/emcc"),
  ["--version"],
  { env, encoding: "utf8" },
);
if (
  compilerVersion.status !== 0 ||
  !/\b3\.1\.56\b/.test(compilerVersion.stdout ?? "")
) {
  throw new Error(
    "Activate Emscripten 3.1.56 in MIACODE_EMSDK_ROOT before building",
  );
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: here, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("cmake", [
  "-S",
  here,
  "-B",
  build,
  "-G",
  "Ninja",
  "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_TOOLCHAIN_FILE=${qtRoot}/wasm_singlethread/lib/cmake/Qt6/qt.toolchain.cmake`,
  `-DQT_HOST_PATH=${qtRoot}/gcc_64`,
]);
run("cmake", [
  "--build",
  build,
  "--parallel",
  process.env.MIACODE_BUILD_JOBS ?? "6",
]);
mkdirSync(publicRoot, { recursive: true });
for (const name of [
  "miacode-preview.js",
  "miacode-preview.wasm",
  "qtloader.js",
]) {
  copyFileSync(join(build, name), join(publicRoot, name));
}
const source = JSON.parse(
  readFileSync(join(here, "upstream-manifest.json"), "utf8"),
);
const adapterHash = createHash("sha256");
for (const file of [
  "browser-host.cpp",
  "CMakeLists.txt",
  "build.mjs",
  "upstream-sources.cmake",
  "shims/UiText.h",
  "shims/common/OperationLog.h",
  "shims/common/DebugLog.h",
  "shims/preview/runtime/PreviewRuntime.h",
  "sdk-bridge.mjs",
  "protocol.mjs",
  "player.mjs",
  "runtime.mjs",
  "resolution.mjs",
  "player.css",
  "index.html",
]) {
  const path = [
    "sdk-bridge.mjs",
    "protocol.mjs",
    "player.mjs",
    "runtime.mjs",
    "resolution.mjs",
    "player.css",
    "index.html",
  ].includes(file)
    ? join(publicRoot, file)
    : join(here, file);
  adapterHash.update(file).update(readFileSync(path));
}
const identity = {
  upstream: "MiaCodeWebGL",
  version: `miaview-web-1-${adapterHash.digest("hex").slice(0, 12)}`,
  sourceRevision: source.sourceRevision,
  protocolVersion: 1,
  qtVersion: "6.8.3",
  emscriptenVersion: "3.1.56",
  width: 1920,
  height: 1080,
  supportedAspectRatios: ["16:9", "1:1"],
  maxRenderDimension: 4096,
  targetFps: 60,
};
writeFileSync(
  join(publicRoot, "build-identity.json"),
  JSON.stringify(identity, null, 2) + "\n",
);
const artifacts = readdirSync(publicRoot).filter(
  (name) =>
    /\.(wasm|js|mjs|css|html|json)$/.test(name) &&
    name !== "artifact-manifest.json",
);
artifacts.push(
  ...readdirSync(join(publicRoot, "sfx")).map((name) => `sfx/${name}`),
);
writeFileSync(
  join(publicRoot, "artifact-manifest.json"),
  JSON.stringify(
    {
      files: artifacts.map((path) => ({
        path,
        byteSize: readFileSync(join(publicRoot, path)).byteLength,
        sha256: createHash("sha256")
          .update(readFileSync(join(publicRoot, path)))
          .digest("hex"),
      })),
    },
    null,
    2,
  ) + "\n",
);
for (const file of ["LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md"])
  copyFileSync(join(here, "upstream", file), join(publicRoot, file));
console.log(`Built local preview: ${identity.version}`);
