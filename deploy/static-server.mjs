import { createReadStream, existsSync } from "node:fs";
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

  response.writeHead(200, {
    "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Type": contentType(filePath),
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
}).listen(port, "0.0.0.0", () => console.log(`Village Siege client listening on http://0.0.0.0:${port}`));

function contentType(filePath) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  })[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
