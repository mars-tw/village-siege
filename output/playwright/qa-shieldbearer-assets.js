async page => {
  const outDir = "C:/Users/digimkt/Documents/Codex/2026-07-17/new-chat/village-siege/output/playwright";
  const results = await page.evaluate(async () => {
    const facings = ["e", "ne", "nw", "w", "sw", "se"];
    return await Promise.all(facings.map(async facing => {
      const url = `/assets/original/units/shieldBearer/sprites/facings/${facing}.png`;
      const response = await fetch(url, { cache: "no-store" });
      const image = new Image();
      image.src = `${url}?decode=${Date.now()}-${facing}`;
      await image.decode();
      return {
        facing,
        url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        width: image.naturalWidth,
        height: image.naturalHeight,
        pass: response.status === 200 && image.naturalWidth === 448 && image.naturalHeight === 672,
      };
    }));
  });
  const evidence = {
    generatedAt: new Date().toISOString(),
    expectedDimensions: { width: 448, height: 672 },
    pass: results.length === 6 && results.every(result => result.pass),
    results,
  };
  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(({ filename, json }) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, { filename: "shieldbearer-facing-http-decode.json", json: JSON.stringify(evidence, null, 2) + "\n" });
  const download = await downloadPromise;
  await download.saveAs(`${outDir}/shieldbearer-facing-http-decode.json`);
  return evidence;
}
