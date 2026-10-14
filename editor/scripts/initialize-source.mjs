import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sourcePin } from "./source-pin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function git(args) {
  const result = spawnSync("git", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Source initialization failed; continue in vendor/MiaCode after resolving the Git error");
}
if (existsSync(join(root, "source-config.json"))) {
  const pin = sourcePin(root), destination = join(root, "vendor/MiaCode");
  if (!existsSync(destination)) git(["clone", "--no-checkout", pin.upstream, destination]);
  git(["-C", destination, "checkout", "--detach", pin.upstreamGitCommit]);
} else git(["submodule", "update", "--init", "vendor/MiaCode"]);
