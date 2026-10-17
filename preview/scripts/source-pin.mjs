import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function sourcePin(root) {
  const configuration = join(root, "source-config.json");
  if (existsSync(configuration)) return JSON.parse(readFileSync(configuration, "utf8"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  return { upstream: git("config", "-f", ".gitmodules", "submodule.vendor/MiaCode.url"),
    upstreamGitCommit: git("ls-files", "--stage", "vendor/MiaCode").split(" ")[1] };
}
