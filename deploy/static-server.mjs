import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { createRuntimeConfigBody, normalizeConnectOrigin } from "./runtime-config.mjs";

const root = resolve(process.env.STATIC_ROOT ?? "/app/public");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");

const connectOrigin = normalizeConnectOrigin(process.env.PUBLIC_CONNECT_ORIGIN);
const connectSource = connectOrigin
  ? ` ${connectOrigin} ${connectOrigin.replace(/^https:/, "wss:")}`
  : "";
const runtimeConfigBody = createRuntimeConfigBody(connectOrigin);
const securityHeaders = {
  "Content-Security-Policy": `default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'${connectSource}; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'none'; form-action 'self'; frame-ancestors 'none'`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

createServer((request, response) => {
  Object.entries(securityHeaders).forEach(([name, value]) => response.setHeader(name, value));
  if (request.url === "/_health") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
    response.end('{"status":"live"}');
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (pathname === "/runtime-config.js") {
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
    if (request.method === "HEAD") response.end();
    else response.end(runtimeConfigBody);
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  let filePath = resolve(root, `.${requested}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (!existsSync(filePath)) filePath = resolve(root, "index.html");

  const size = statSync(filePath).size;
  const range = extname(filePath).toLowerCase() === ".mp4" ? parseByteRange(request.headers.range, size) : undefined;
  if (range === null) {
    response.writeHead(416, { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }
  const headers = {
    "Cache-Control": /(?:\.html|sw\.js|manifest\.webmanifest|startup\.js|startup\.css)$/.test(filePath)
      ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentType(filePath),
    "Content-Length": range ? range.end - range.start + 1 : size,
    ...(extname(filePath).toLowerCase() === ".mp4" ? { "Accept-Ranges": "bytes" } : {}),
    ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
  };
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath, range ?? undefined).on("error", () => response.destroy()).pipe(response);
}).listen(port, "0.0.0.0", () => console.log(`Village Siege client listening on http://0.0.0.0:${port}`));

function contentType(filePath) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
  })[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function parseByteRange(header, size) {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === "" ? size - 1 : Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
