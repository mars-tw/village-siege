import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

async function listen(child) {
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("Village Siege client listening")) return;
  }
  throw new Error(`static server exited before listening: ${output}`);
}

test("static server supports MP4 MIME, single byte ranges, and immutable caching", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "village-siege-media-"));
  const body = Buffer.from("0123456789abcdef", "ascii");
  await writeFile(join(root, "index.html"), "shell");
  await writeFile(join(root, "clip.mp4"), body);
  const port = 49152 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ["deploy/static-server.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, STATIC_ROOT: root, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    child.kill();
    await rm(root, { recursive: true, force: true });
  });
  await listen(child);
  const full = await fetch(`http://127.0.0.1:${port}/clip.mp4`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), body);

  const partial = await fetch(`http://127.0.0.1:${port}/clip.mp4`, { headers: { Range: "bytes=3-7" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 3-7/${body.length}`);
  assert.equal(await partial.text(), "34567");

  const unsatisfiable = await fetch(`http://127.0.0.1:${port}/clip.mp4`, { headers: { Range: "bytes=99-" } });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers.get("content-range"), `bytes */${body.length}`);
});
