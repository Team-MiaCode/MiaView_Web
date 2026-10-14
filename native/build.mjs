import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeArtifacts } from "./artifacts.mjs";
import { syncTheme } from "../scripts/sync-theme.mjs";
import { nativeInputsFingerprint } from "../scripts/build-identity.mjs";
import { sourcePin } from "../scripts/source-pin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const toolchain = JSON.parse(readFileSync(join(here, "toolchain.json")));
const development = process.argv.includes("--development");
const source = resolve(process.env.MIACODE_SOURCE_DIR ?? join(root, "vendor/MiaCode"));
const qtRoot = resolve(process.env.MIACODE_QT_ROOT ?? join(root, ".deps/qt", toolchain.qtVersion));
const installedHost = join(qtRoot, process.platform === "win32" ? "msvc2022_64" : "gcc_64");
const qtHost = resolve(process.env.MIACODE_QT_HOST_PATH ?? installedHost);
const emsdk = resolve(process.env.MIACODE_EMSDK_ROOT ?? join(root, ".deps/emsdk"));
const build = resolve(process.env.MIACODE_BUILD_DIR ?? join(root, "build-devtools"));
const jobs = Number(process.env.MIACODE_BUILD_JOBS ?? 4);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4)
  throw new Error("MIACODE_BUILD_JOBS must be an integer from 1 to 4");
if (!existsSync(join(source, "cmake/MiaCodePreviewBuild.cmake")))
  throw new Error("Initialize vendor/MiaCode at the recorded preview-capable revision");
if (!existsSync(join(qtRoot, toolchain.wasmArch, "lib/cmake/Qt6/qt.toolchain.cmake")))
  throw new Error(`Install Qt ${toolchain.qtVersion} ${toolchain.wasmArch} in MIACODE_QT_ROOT`);
if (!existsSync(join(qtHost, "lib/cmake/Qt6/Qt6Config.cmake")))
  throw new Error(`Set MIACODE_QT_HOST_PATH to the matching Qt ${toolchain.qtVersion} host`);
if (!development && source !== resolve(root, "vendor/MiaCode"))
  throw new Error("Local source overrides require --development; release builds use the submodule");

const env = { ...process.env, EMSDK: emsdk, EM_CONFIG: join(emsdk, ".emscripten"),
  PATH: [join(emsdk, "upstream/emscripten"), process.env.PATH].join(delimiter) };
if (process.platform === "linux")
  env.LD_LIBRARY_PATH = [join(qtHost, "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
const pythonDirectory = join(emsdk, "python");
const bundledPython = existsSync(pythonDirectory)
  ? readdirSync(pythonDirectory).find(name => existsSync(join(pythonDirectory, name, "python.exe"))) : undefined;
const python = process.env.EMSDK_PYTHON ?? (process.platform === "win32" && bundledPython
  ? join(pythonDirectory, bundledPython, "python.exe")
  : process.platform === "win32" ? "python" : "python3");
env.EMSDK_PYTHON = python;

function capture(command, args, cwd = here) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
const git = (...args) => capture("git", ["-C", source, ...args]);
const upstreamGitCommit = git("rev-parse", "HEAD").trim();
const upstreamTree = git("rev-parse", "HEAD^{tree}").trim();
const sourcePaths = ["CMakeLists.txt", "src", "cmake", "resources", "assets"];
const changes = git("diff", "--binary", "HEAD", "--", ...sourcePaths);
const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", ...sourcePaths)
  .split("\0").filter(Boolean).sort();
const upstreamDirty = changes.length > 0 || untracked.length > 0;
if (upstreamDirty && !development)
  throw new Error("Upstream source is dirty; commit it and update the submodule, or use --development");
if (!development) {
  const recorded = sourcePin(root).upstreamGitCommit;
  if (recorded !== upstreamGitCommit)
    throw new Error("MiaCode checkout differs from the recorded submodule commit");
}
const sourceHash = createHash("sha256").update(upstreamTree).update(changes);
for (const path of untracked) sourceHash.update(path).update(readFileSync(join(source, path)));
const sourceRevision = sourceHash.digest("hex");

const compilerVersion = capture(python, [join(emsdk, "upstream/emscripten/emcc.py"), "--version"]);
if (!compilerVersion.includes(` ${toolchain.emscriptenVersion} `))
  throw new Error(`Activate Emscripten ${toolchain.emscriptenVersion} to match this Qt build`);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: here, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const configure = ["-S", here, "-B", build, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_TOOLCHAIN_FILE=${qtRoot}/${toolchain.wasmArch}/lib/cmake/Qt6/qt.toolchain.cmake`,
  `-DQT_HOST_PATH=${qtHost}`, `-DMIACODE_SOURCE_DIR=${source}`];
let ninja = process.env.MIACODE_NINJA;
if (!ninja && process.platform === "win32") {
  const cmake = capture("where.exe", ["cmake"]).trim().split(/\r?\n/)[0];
  const bundled = resolve(dirname(cmake), "../../Ninja/ninja.exe");
  if (existsSync(bundled)) ninja = bundled;
}
if (ninja) configure.push(`-DCMAKE_MAKE_PROGRAM=${ninja}`);
if (process.platform === "linux") run(join(qtHost, "bin/qsb"), ["--version"]);
run("cmake", configure);
run("cmake", ["--build", build, "--parallel", String(jobs)]);

const publicRoot = join(root, "renderer");
mkdirSync(join(publicRoot, "sfx"), { recursive: true });
for (const name of ["answer.wav", "break_slide.wav", "break_tap.wav", "break.wav",
  "slide_break_slide.wav", "slide_break_start.wav", "slide.wav", "tap_ex.wav",
  "tap_perfect.wav", "touch_hanabi.wav", "touch_Hold_riser.wav", "touch.wav"])
  copyFileSync(join(source, "assets/SFX", name), join(publicRoot, "sfx", name));
syncTheme(source, upstreamGitCommit);
copyFileSync(join(build, "miacode-preview.wasm"), join(publicRoot, "miacode-preview.wasm"));
// Keep generated text reproducible across host line-ending conventions.
for (const name of ["miacode-preview.js", "qtloader.js", "LICENSE", "LICENSE_SCOPE.md", "THIRD_PARTY_NOTICES.md"]) {
  const input = join(name.endsWith(".js") ? build : source, name);
  const text = readFileSync(input, "utf8").replace(/\r\n/g, "\n").replace(/^[ \t]+$/gm, "");
  writeFileSync(join(publicRoot, name), text);
}
const identity = {
  upstream: "MiaCodeWebGL",
  sourceRevision, upstreamGitCommit, upstreamTree, upstreamDirty,
  nativeInputsFingerprint: nativeInputsFingerprint(sourceRevision, toolchain, here),
  protocolVersion: 1, ...toolchain, width: 1920, height: 1080,
  supportedAspectRatios: ["16:9", "1:1"], maxRenderDimension: 4096, targetFps: 60,
};
const completed = writeArtifacts(identity);
console.log(`Built ${completed.version} from MiaCode ${upstreamGitCommit}${upstreamDirty ? " (development changes)" : ""}`);
