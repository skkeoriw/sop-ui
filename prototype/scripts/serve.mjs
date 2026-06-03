import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg.includes("=")) {
    const [key, value] = arg.split("=");
    args.set(key, value ?? true);
  } else if (arg.startsWith("--")) {
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(arg, next);
      i += 1;
    } else {
      args.set(arg, true);
    }
  }
}

const host = String(args.get("--host") || "127.0.0.1");
const port = Number(args.get("--port") || 5190);
const root = resolve("dist");

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".webp", "image/webp"]
]);

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const candidate = join(root, pathname === "/" ? "index.html" : pathname);
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
  res.setHeader("Content-Type", types.get(extname(file)) || "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`sop-ui-prototype listening on http://${host}:${port}`);
});
