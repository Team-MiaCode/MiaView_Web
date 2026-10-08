import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};
export function staticServer(directory = root) {
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (pathname === "/") {
        res.writeHead(302, { Location: "/examples/index.html" }).end();
        return;
      }
      const path = resolve(
        directory,
        `.${pathname}`,
      );
      if (!path.startsWith(directory + sep) || !(await stat(path)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT ?? 3030);
  staticServer().listen(port, "127.0.0.1", () =>
    console.log(`Preview example: http://localhost:${port}`),
  );
}
