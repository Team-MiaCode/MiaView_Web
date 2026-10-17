import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const base = realpathSync(process.env.MIACODE_PRODUCTS_ROOT);
const products = [];
for (const product of ["editor", "preview"]) {
  const root = realpathSync(resolve(base, product));
  const cache = Object.fromEntries([...readFileSync(resolve(root, "build-devtools/CMakeCache.txt"), "utf8")
    .matchAll(/^([A-Za-z_][^:=\r\n]*):[^=\r\n]+=(.*)$/gm)].map(match => [match[1], match[2].trim()]));
  assert.equal(cache.CMAKE_BUILD_TYPE, "Release");
  const numericVersion = [cache.CMAKE_CACHE_MAJOR_VERSION, cache.CMAKE_CACHE_MINOR_VERSION, cache.CMAKE_CACHE_PATCH_VERSION].join(".");
  const versions = readdirSync(resolve(root, "build-devtools/CMakeFiles"), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(numericVersion));
  assert.equal(versions.length, 1); const cmakeVersion = versions[0].name;
  for (const language of ["C", "CXX"]) {
    const configuration = readFileSync(resolve(root, `build-devtools/CMakeFiles/${cmakeVersion}/CMake${language}Compiler.cmake`), "utf8");
    cache[`CMAKE_${language}_COMPILER`] = configuration.match(new RegExp(`set\\(CMAKE_${language}_COMPILER "([^"]+)"\\)`))?.[1];
  }
  const inputs = {};
  for (const key of ["CMAKE_HOME_DIRECTORY", "MIACODE_SOURCE_DIR", "QT_HOST_PATH", "CMAKE_TOOLCHAIN_FILE", "CMAKE_MAKE_PROGRAM", "CMAKE_C_COMPILER", "CMAKE_CXX_COMPILER"]) {
    assert.ok(cache[key], `${product}: ${key}`);
    const path = realpathSync(cache[key]);
    assert.ok(path.startsWith(root + sep), `${product}/${key}: ${path}`); inputs[key] = path;
  }
  const git = (...args) => {
    const result = spawnSync("git", ["-C", resolve(root, "vendor/MiaCode"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const source = JSON.parse(readFileSync(resolve(root, "source-config.json"), "utf8"));
  assert.equal(git("rev-parse", "HEAD"), source.upstreamGitCommit);
  assert.ok(realpathSync(git("rev-parse", "--absolute-git-dir")).startsWith(root + sep));
  const identity = JSON.parse(readFileSync(resolve(root, "renderer/build-identity.json"), "utf8"));
  assert.equal(identity.upstreamGitCommit, source.upstreamGitCommit);
  products.push({ product, root, configuration: cache.CMAKE_BUILD_TYPE, identity, inputs });
  console.log(`${product}: Release compiler, Qt, Ninja, source checkout and build paths belong to this product`);
}
mkdirSync("artifacts/products", { recursive: true });
writeFileSync("artifacts/products/builds.json", JSON.stringify({ base, products }, null, 2) + "\n");
