import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPython = join(root, ".deps/python/Scripts/python.exe");
const python = process.env.MIACODE_FONT_PYTHON ?? (existsSync(localPython) ? localPython : process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, [join(root, "scripts/sync-font.py")], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
