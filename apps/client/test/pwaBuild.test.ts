import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedConfig } from "vite";
import { villageSiegePwa } from "../build/pwaPlugin";

const fixtures: string[] = [];
const workerTemplate = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

afterEach(async () => {
  for (const directory of fixtures.splice(0)) {
    // Restrict recursive cleanup to the explicitly-created test directory.
    expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
    expect(path.basename(directory)).toMatch(/^village-siege-pwa-test-/);
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(base = "/village-siege/") {
  const root = await mkdtemp(path.join(tmpdir(), "village-siege-pwa-test-"));
  fixtures.push(root);
  const client = path.join(root, "apps/client");
  const output = path.join(client, "dist");
  const publicDir = path.join(client, "public");
  async function put(file: string, content: string) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  await mkdir(publicDir, { recursive: true });
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(publicDir, "sw.js"), workerTemplate);
  await writeFile(path.join(root, "assets/release-asset-manifest.json"), JSON.stringify({ assets: [
    { file: "apps/client/public/assets/original/units/warrior/sprites/action-sheet.png", runtime: true },
    { file: "apps/client/public/assets/original/source/reference.png", runtime: false },
  ] }));
  await put("index.html", "<main>Offline game</main>");
  await put("manifest.webmanifest", JSON.stringify({ icons: [{ src: "icons/app-192.png" }] }));
  await put("icons/app-192.png", "icon fixture");
  await put("assets/app-123.js", "console.log('game');");
  await put("assets/original/units/warrior/sprites/action-sheet.png", "approved sprite fixture");
  await put("assets/original/source/reference.png", "unapproved source fixture");
  await put("runtime-config.js", "deployment-specific config");
  await put("sw.js", workerTemplate);
  const plugin = villageSiegePwa();
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root: client, publicDir, base,
    build: { outDir: "dist" }, logger: { info() {} },
  } as unknown as ResolvedConfig);
  const build = plugin.closeBundle as () => Promise<void>;
  return { output, put, build };
}

function workerData(source: string) {
  return {
    version: /const BUILD_VERSION = "([a-f0-9]+)";/.exec(source)![1],
    files: JSON.parse(/const PRECACHE_PATHS = (.+);/.exec(source)![1]!) as string[],
    integrity: JSON.parse(/const PRECACHE_INTEGRITY = (.+);/.exec(source)![1]!) as Record<string, string>,
  };
}

describe("PWA build contract", () => {
  it("pins every emitted offline file while excluding live config and pruned source art", async () => {
    const project = await fixture();
    await project.build();
    const data = workerData(await readFile(path.join(project.output, "sw.js"), "utf8"));
    expect(data.files).toContain("assets/original/units/warrior/sprites/action-sheet.png");
    expect(data.files).not.toContain("runtime-config.js");
    expect(data.files).not.toContain("sw.js");
    expect(data.files).not.toContain("assets/original/source/reference.png");
    expect(Object.keys(data.integrity)).toEqual(data.files);
    for (const file of data.files) {
      const content = await readFile(path.join(project.output, file));
      expect(data.integrity[file]).toBe(`sha256-${createHash("sha256").update(content).digest("base64")}`);
    }
  });

  it("art-only edits change both the cache generation and the pinned art digest", async () => {
    const project = await fixture();
    const art = "assets/original/units/warrior/sprites/action-sheet.png";
    await project.build();
    const before = workerData(await readFile(path.join(project.output, "sw.js"), "utf8"));
    await project.put(art, "new approved sprite bytes");
    await project.build();
    const after = workerData(await readFile(path.join(project.output, "sw.js"), "utf8"));
    expect(after.version).not.toBe(before.version);
    expect(after.integrity[art]).not.toBe(before.integrity[art]);
    expect(after.integrity["assets/app-123.js"]).toBe(before.integrity["assets/app-123.js"]);
  });

  it("refuses an incomplete app installation manifest", async () => {
    const project = await fixture();
    await rm(path.join(project.output, "icons/app-192.png"));
    await expect(project.build()).rejects.toThrow("missing its manifest icon");
  });
});
