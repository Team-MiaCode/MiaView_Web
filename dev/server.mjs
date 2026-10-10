import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performanceLogger } from "../backend/log.mjs";
import { devChartUploads } from "./chart-upload.mjs";
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
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export function staticServer(
  directory = root,
  {
    performanceLogDir = null,
    performanceTerminal = true,
    performanceOutput,
  } = {},
) {
  const log = performanceLogger({
    directory: performanceLogDir,
    terminal: performanceTerminal,
    writeTerminal: performanceOutput,
  });
  const uploads = devChartUploads();
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (pathname.endsWith("/__performance")) {
        await log(req, res);
        return;
      }
      const uploaded = await uploads.route(req, res, pathname);
      if (uploaded?.handled) return;
      // Missing static assets must expose their HTTP status to embedded
      // renderers too, rather than being masked as a CORS fetch failure.
      res.setHeader("Access-Control-Allow-Origin", "*");
      // Dev logs contain local diagnostics and must not be served as assets.
      if (pathname.startsWith("/.logs/")) {
        res.writeHead(404).end();
        return;
      }
      if (pathname === "/") {
        res.writeHead(302, { Location: "/examples/index.html" }).end();
        return;
      }
      const path = uploaded?.path ?? resolve(directory, `.${pathname}`);
      const logsRoot = resolve(directory, ".logs");
      if (path === logsRoot || path.startsWith(logsRoot + sep)) {
        res.writeHead(404).end();
        return;
      }
      if (
        !path.startsWith((uploaded?.directory ?? directory) + sep) ||
        !(await stat(path)).isFile()
      ) {
        res.writeHead(404).end();
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      let servedPath = path;
      let encoding;
      // Ranges refer to original media bytes, never compressed sidecars.
      if (!req.headers.range && /\.(wasm|js)$/.test(path)) {
        const preferences = new Map(
          (req.headers["accept-encoding"] ?? "").split(",").map((part) => {
            const [name, quality] = part.trim().split(";q=");
            return [name, quality === undefined ? 1 : Number(quality)];
          }),
        );
        const candidates = ["br", "gzip"]
          .map((name) => ({
            name,
            quality: preferences.get(name) ?? preferences.get("*") ?? 0,
          }))
          .filter(({ quality }) => quality > 0)
          .sort((a, b) => b.quality - a.quality);
        const original = await stat(path);
        for (const { name } of candidates) {
          const candidate = `${path}.${name === "br" ? "br" : "gz"}`;
          const info = await stat(candidate).catch(() => null);
          if (info?.isFile() && info.mtimeMs >= original.mtimeMs) {
            servedPath = candidate;
            encoding = name;
            break;
          }
        }
      }
      const info = await stat(servedPath);
      let immutable = false;
      const build = new URL(req.url, "http://localhost").searchParams.get(
        "build",
      );
      if (build && pathname.startsWith("/renderer/")) {
        const identity = await readFile(
          resolve(directory, "renderer/build-identity.json"),
          "utf8",
        )
          .then(JSON.parse)
          .catch(() => null);
        immutable = identity?.version === build;
      }
      const metadata = /\/(build-identity|artifact-manifest)\.json$/.test(
        pathname,
      );
      const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}-${encoding ?? "identity"}"`;
      const headers = {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control":
          metadata || uploaded
            ? "no-store"
            : immutable
              ? "public, max-age=31536000, immutable"
              : "no-cache",
        "Accept-Ranges": "bytes",
        Vary: "Accept-Encoding",
        ETag: etag,
        ...(encoding ? { "Content-Encoding": encoding } : {}),
      };
      if (!metadata && !uploaded && req.headers["if-none-match"] === etag) {
        res.writeHead(304, headers).end();
        return;
      }
      let start = 0,
        end = info.size - 1,
        status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (match && (match[1] || match[2])) {
          start = match[1]
            ? Number(match[1])
            : Math.max(0, info.size - Number(match[2]));
          end = match[1]
            ? match[2]
              ? Math.min(Number(match[2]), end)
              : end
            : end;
        }
        if (
          !match ||
          (!match[1] && (!match[2] || Number(match[2]) === 0)) ||
          start > end ||
          start >= info.size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          res
            .writeHead(416, {
              ...headers,
              "Content-Range": `bytes */${info.size}`,
            })
            .end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      headers["Content-Length"] = String(Math.max(0, end - start + 1));
      res.writeHead(status, headers);
      if (req.method === "HEAD" || !info.size) res.end();
      else await pipeline(createReadStream(servedPath, { start, end }), res);
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(404).end();
    }
  });
  server.on("close", () => {
    void uploads.close().catch(() => {});
  });
  return server;
}
