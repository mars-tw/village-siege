export function approvedRuntimeArtFromManifest(releaseManifest) {
  const publicPrefix = "apps/client/public/";
  return new Set(
    releaseManifest.assets
      .filter((asset) => asset.runtime === true && /\.(?:png|webp)$/.test(asset.file))
      .map((asset) => {
        if (!asset.file.startsWith(publicPrefix)) throw new Error(`Runtime art is outside the public root: ${asset.file}`);
        return asset.file.slice(publicPrefix.length);
      }),
  );
}

export function shouldPruneRuntimeArt(relative, approvedRuntimeArt) {
  return /\.(?:png|webp)$/.test(relative) && !approvedRuntimeArt.has(relative);
}
/** Runtime art is the current frontier set; previous-generation masters stay build-only. */
export function isRuntimeOriginalAssetPath(file) {
  return /\/frontier\/(?:buildings(?:-menu)?\.webp|command-icons\.png|cover\.webp|landscape\/(?:materials|nature)\.webp)$/.test(file)
    || /\/frontier\/characters\/(?:villager|warrior|archer|shieldBearer)\/facings\/(?:e|ne|nw|w|sw|se)\.png$/.test(file)
    || /\/frontier\/characters\/(?:mage|musketeer|boarRider|heavyCrossbowman)\/action-sheet\.png$/.test(file)
    || /\/frontier\/monsters\/(?:miremaw|ashwing|rootback)\/action-sheet\.png$/.test(file);
}
