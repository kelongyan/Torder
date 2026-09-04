/**
 * serve.mjs — 设计稿本地预览服务器（零依赖）
 * 用法：node tools/serve.mjs [port，默认 5180]，然后浏览器打开 http://localhost:5180/
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "..");
const port = Number(process.argv[2]) || 5180;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split("?")[0]);
    if (path === "/") path = "/index.html";
    const file = normalize(join(publicRoot, path));
    if (!file.startsWith(normalize(publicRoot))) {
      res.writeHead(403); res.end("forbidden"); return;
    }
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(port, () => console.log(`Torder 设计稿预览：http://localhost:${port}/`));
