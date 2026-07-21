export function approvedRuntimePngsFromManifest(releaseManifest) {
  const publicPrefix = "apps/client/public/";
  return new Set(
    releaseManifest.assets
      .filter((asset) => asset.runtime === true && asset.file.endsWith(".png"))
      .map((asset) => {
        if (!asset.file.startsWith(publicPrefix)) throw new Error(`Runtime PNG is outside the public root: ${asset.file}`);
        return asset.file.slice(publicPrefix.length);
      }),
  );
}

export function shouldPruneRuntimePng(relative, approvedRuntimePngs) {
  return relative.endsWith(".png") && !approvedRuntimePngs.has(relative);
}
