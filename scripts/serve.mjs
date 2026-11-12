// A static server for trying the report page outside the extension: http://localhost:5180/dist/report.html?src=/test/fixtures/edited.jpg
// Serves the project folder read-only, on localhost only.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4" };
const port = Number(process.env.PORT ?? 5180);

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
  const file = join(root, path);
  if (!file.startsWith(root) || /(^|[/\\])(node_modules|\.git)([/\\]|$)/.test(path)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end("not found"); return; }
  if (!st.isFile()) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[/** @type {keyof typeof TYPES} */ (extname(file).toLowerCase())] ?? "application/octet-stream", "content-length": st.size });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/dist/report.html?src=/test/fixtures/edited.jpg`));
