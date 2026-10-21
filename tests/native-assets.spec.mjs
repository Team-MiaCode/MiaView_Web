import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const host = readFileSync(new URL("../native/browser-host.cpp", import.meta.url), "utf8");
const resources = readFileSync(new URL("../native/browser-assets.qrc.in", import.meta.url), "utf8");

test("native startup and lazy SD loading both use embedded Qt resources", () => {
  assert.match(host, /setAssetRoot\(QStringLiteral\(":\/assets"\)\)/);
  const skinRoots = [...host.matchAll(/PreviewSceneAssetLoader::load\(\s*"([^"]+)"/g)]
    .map(match => match[1]).sort();
  assert.deepEqual(skinRoots, [":/assets/skin/skinDX", ":/assets/skin/skinSD"]);
  // Check that both loader roots still match the resource aliases we package.
  for (const root of skinRoots)
    assert.ok(resources.includes(`alias="${root.slice(2)}/tap.png"`), root);
});

test("native host does not recreate a filesystem copy of the embedded bundle", () => {
  assert.doesNotMatch(host, /["']\/assets(?:\/|["'])/);
  assert.doesNotMatch(host, /\bmountAssets\b|QFile::copy|QDirIterator/);
});
