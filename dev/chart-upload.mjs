import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const extensions = {
  maidata: [".txt"],
  audio: [".mp3", ".wav", ".ogg", ".flac", ".m4a"],
  cover: [".png", ".jpg", ".jpeg", ".webp"],
  video: [".mp4", ".webm"],
};
const prefix = "/__dev-charts";
const maxBytes = 2 * 1024 ** 3;
const json = (res, status, body) =>
  res
    .writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(body));

// Dev-only staging area. Uploads are streamed to temporary files, never to
// repository paths. GET becomes available only after a complete upload.
export function devChartUploads() {
  let storage;
  const sessions = new Map();
  return {
    async close() {
      if (storage) await rm(await storage, { recursive: true, force: true });
      sessions.clear();
    },
    async route(req, res, pathname) {
      if (pathname !== prefix && !pathname.startsWith(prefix + "/"))
        return null;
      if (["POST", "PUT"].includes(req.method)) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {}
        if (
          !origin ||
          !["http:", "https:"].includes(origin.protocol) ||
          origin.host !== req.headers.host
        ) {
          json(res, 403, { error: "上传仅接受本页面的同源请求" });
          return { handled: true };
        }
      }
      if (pathname === prefix && req.method === "POST") {
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) {
              json(res, 413, { error: "文件信息过大" });
              return { handled: true };
            }
            chunks.push(chunk);
          }
          const resources = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const entries = Object.entries(resources);
          if (
            !resources.maidata ||
            entries.length > 4 ||
            entries.some(
              ([kind, file]) =>
                !extensions[kind] ||
                typeof file?.name !== "string" ||
                !extensions[kind].includes(extname(file.name).toLowerCase()) ||
                !Number.isSafeInteger(file.size) ||
                file.size <= 0 ||
                file.size > maxBytes,
            )
          )
            throw new Error("请上传有效的谱面及音视频文件");
          storage ??= mkdtemp(join(tmpdir(), "miaview-dev-charts-"));
          const directory = join(await storage, randomUUID());
          await mkdir(directory);
          const id = directory.split(/[\\/]/).at(-1);
          const files = new Map();
          const chart = {};
          for (const [kind, file] of entries) {
            const name = kind + extname(file.name).toLowerCase();
            files.set(name, {
              path: join(directory, name),
              size: file.size,
              ready: false,
              uploading: false,
            });
            chart[kind] = { url: `${prefix}/${id}/${name}` };
          }
          sessions.set(id, { directory, files });
          json(res, 201, { chart });
        } catch (error) {
          json(res, 400, { error: error.message });
        }
        return { handled: true };
      }
      const parts = pathname.slice(prefix.length + 1).split("/");
      const session = parts.length === 2 ? sessions.get(parts[0]) : null;
      const file = session?.files.get(parts[1]);
      if (!file) {
        json(res, 404, { error: "上传资源不存在" });
        return { handled: true };
      }
      if (req.method === "PUT") {
        if (file.uploading || file.ready) {
          json(res, 409, { error: "文件已上传或正在上传" });
          return { handled: true };
        }
        if (
          req.headers["content-length"] !== undefined &&
          Number(req.headers["content-length"]) !== file.size
        ) {
          json(res, 400, { error: "上传大小与文件信息不一致" });
          return { handled: true };
        }
        file.uploading = true;
        const staging = file.path + ".part";
        let size = 0;
        try {
          await pipeline(
            req,
            new Transform({
              transform(chunk, _encoding, callback) {
                size += chunk.length;
                callback(
                  size > file.size ? new Error("上传超出文件大小") : null,
                  chunk,
                );
              },
            }),
            createWriteStream(staging, { flags: "wx" }),
          );
          if (size !== file.size) throw new Error("文件上传不完整");
          await rename(staging, file.path);
          file.ready = true;
          json(res, 200, { ok: true });
        } catch (error) {
          await rm(staging, { force: true });
          if (!res.destroyed) json(res, 400, { error: error.message });
        } finally {
          file.uploading = false;
        }
        return { handled: true };
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD, PUT" }).end();
        return { handled: true };
      }
      if (!file.ready) {
        json(res, 404, { error: "文件尚未上传完成" });
        return { handled: true };
      }
      return { path: file.path, directory: session.directory };
    },
  };
}
