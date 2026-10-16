import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=join(root,"node_modules/mediabunny"),target=join(root,"renderer/vendor/mediabunny");
const metadata=JSON.parse(readFileSync(join(source,"package.json"),"utf8"));
if(metadata.version!=="1.61.4")throw new Error("Install the pinned Mediabunny dependency");
mkdirSync(target,{recursive:true});
copyFileSync(join(source,"dist/bundles/mediabunny.min.mjs"),join(target,"index.mjs"));
copyFileSync(join(source,"LICENSE"),join(target,"LICENSE"));
writeFileSync(join(target,"NOTICE.md"),`# Mediabunny\n\nVersion: ${metadata.version}\n\nLicense: MPL-2.0, included in LICENSE.\n\nOriginal source: https://github.com/Vanilagy/mediabunny/tree/v${metadata.version}\n\nThe browser bundle is copied from the pinned npm package.\n`);
console.log(`Synchronized Mediabunny ${metadata.version}`);
