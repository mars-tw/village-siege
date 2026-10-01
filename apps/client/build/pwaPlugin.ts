import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

interface ReleaseAsset {
  readonly file: string;
  readonly runtime?: boolean;
}

/** Emit a worker from the files Vite actually writes, including unbundled game art. */
export function villageSiegePwa(): Plugin {
  let config: ResolvedConfig;
  let failed = false;
  return {
    name: "village-siege-pwa",
    apply: "build",
    enforce: "post",
    configResolved(resolved) { config = resolved; },
    buildEnd(error) { failed = Boolean(error); },
    async closeBundle() {
      if (failed) return;
      const outputRoot = path.resolve(config.root, config.build.outDir);
      const repoRoot = path.resolve(config.root, "../..");
      const manifest = JSON.parse(await readFile(path.join(repoRoot, "assets/release-asset-manifest.json"), "utf8")) as {
        assets: ReleaseAsset[];
      };
      const originalRuntimePngs = new Set(manifest.assets
        .filter((asset) => asset.runtime === true && asset.file.endsWith(".png"))
        .map((asset) => asset.file.replace(/^apps\/client\/public\//, "")));
      const files: string[] = [];
      async function visit(directory: string): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) { await visit(absolute); continue; }
          const relative = path.relative(outputRoot, absolute).split(path.sep).join("/");
          if (relative === "sw.js" || relative === "runtime-config.js" || relative.endsWith(".map")) continue;
          // CI removes production-unapproved original PNGs after Vite emits them.
          if (relative.startsWith("assets/original/") && relative.endsWith(".png")
              && !originalRuntimePngs.has(relative)) continue;
          files.push(relative);
        }
      }
      await visit(outputRoot);
      files.sort();
      if (!files.includes("index.html") || !files.includes("manifest.webmanifest")) {
        throw new Error("PWA build is missing its shell or manifest");
      }
      const appManifest = JSON.parse(await readFile(path.join(outputRoot, "manifest.webmanifest"), "utf8")) as {
        icons: { src: string }[];
      };
      for (const icon of appManifest.icons) {
        if (!files.includes(icon.src.replace(/^\.\//, ""))) {
          throw new Error(`PWA build is missing its manifest icon: ${icon.src}`);
        }
      }
      const revision = createHash("sha256");
      const integrity: Record<string, string> = {};
      // Base and every byte are part of the revision, so art-only changes update too.
      revision.update(config.base);
      for (const file of files) {
        const content = await readFile(path.join(outputRoot, file));
        revision.update(file);
        revision.update(content);
        // Fetch verifies decoded response bytes before Cache.addAll can store them.
        integrity[file] = `sha256-${createHash("sha256").update(content).digest("base64")}`;
      }
      const template = await readFile(path.join(config.publicDir, "sw.js"), "utf8");
      revision.update(template);
      const worker = template
        .replace("__VILLAGE_SIEGE_BUILD_VERSION__", revision.digest("hex").slice(0, 20))
        .replace('["__VILLAGE_SIEGE_PRECACHE__"]', JSON.stringify(files))
        .replace('{"__VILLAGE_SIEGE_INTEGRITY__": ""}', JSON.stringify(integrity));
      await writeFile(path.join(outputRoot, "sw.js"), worker, "utf8");
      config.logger.info(`PWA: prepared ${files.length} runtime files for offline play.`);
    },
  };
}
