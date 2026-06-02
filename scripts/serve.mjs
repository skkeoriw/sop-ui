import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const host = args.get("--host") || "127.0.0.1";
const port = Number(args.get("--port") || "5180");
const root = resolve(args.get("--root") || "dist");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const safePath = rawPath.includes("..") ? "/" : rawPath;
  let file = join(root, safePath === "/" ? "index.html" : safePath);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html");
  }
  res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
  res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-store" : "public, max-age=300");
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`sop-ui listening on http://${host}:${port}`);
});
