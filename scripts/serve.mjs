// Tiny static server for the lab. Serves the repository root.
//   node scripts/serve.mjs              → http://127.0.0.1:5178/lab/
//   node scripts/serve.mjs --port 8080
//   node scripts/serve.mjs --host       → also listen on the LAN (to open the lab on an iPhone)
// Stop it with Ctrl+C (or kill the process on that port — never kill every node.exe).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 5178;
const lan = args.includes("--host");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/lab/";
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (file.split(sep).includes("node_modules") || file.split(sep).includes(".git")) { res.writeHead(404).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
}).listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`EditFrame lab: http://127.0.0.1:${port}/lab/`);
  if (lan) {
    for (const list of Object.values(networkInterfaces())) for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  LAN: http://${a.address}:${port}/lab/`);
    }
  }
});
