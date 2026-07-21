async page => {
  const outDir = "C:/Users/digimkt/Documents/Codex/2026-07-17/new-chat/village-siege/output/playwright";
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];

  page.on("pageerror", error => pageErrors.push({ name: error.name, message: error.message, stack: error.stack ?? null }));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on("requestfailed", request => requestFailures.push({
    url: request.url(),
    method: request.method(),
    errorText: request.failure()?.errorText ?? null,
  }));

  const saveJson = async (filename, value) => {
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(({ filename, json }) => {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }, { filename, json: JSON.stringify(value, null, 2) + "\n" });
    const download = await downloadPromise;
    await download.saveAs(`${outDir}/${filename}`);
  };

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.__VILLAGE_SIEGE_DEV_GAME__?.isBooted === true, null, { timeout: 20000 });
  await page.waitForTimeout(750);

  const assetResults = await page.evaluate(async () => {
    const facings = ["e", "ne", "nw", "w", "sw", "se"];
    const results = [];
    for (const facing of facings) {
      const url = `/assets/original/units/archer/sprites/facings/${facing}.png`;
      try {
        const response = await fetch(url, { cache: "no-store" });
        const blob = await response.blob();
        let width = null;
        let height = null;
        let decoded = false;
        let decodeError = null;
        try {
          const bitmap = await createImageBitmap(blob);
          width = bitmap.width;
          height = bitmap.height;
          decoded = true;
          bitmap.close();
        } catch (error) {
          decodeError = error instanceof Error ? error.message : String(error);
        }
        results.push({
          facing,
          url,
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type"),
          byteLength: blob.size,
          decoded,
          width,
          height,
          decodeError,
          pass: response.status === 200 && response.ok && decoded && width === 384 && height === 672,
        });
      } catch (error) {
        results.push({
          facing,
          url,
          status: null,
          ok: false,
          decoded: false,
          width: null,
          height: null,
          error: error instanceof Error ? error.message : String(error),
          pass: false,
        });
      }
    }
    return results;
  });
  await saveJson("archer-facing-http-decode.json", {
    generatedAt: new Date().toISOString(),
    expectedDimensions: { width: 384, height: 672 },
    pass: assetResults.length === 6 && assetResults.every(result => result.pass),
    results: assetResults,
  });

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "開始單機戰役", exact: true }).click();
  await page.waitForFunction(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game?.scene?.getScene("VillageAssaultScene");
    return Boolean(game?.scene?.isActive("VillageAssaultScene") && scene?.actionButtons?.length === 7 && scene?.runtime);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  const collectLayout = async state => page.evaluate(stateName => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game.scene.getScene("VillageAssaultScene");
    const activeScenes = game.scene.getScenes(true).map(activeScene => activeScene.scene.key);
    const canvasRectRaw = document.querySelector("canvas")?.getBoundingClientRect();
    const canvasRect = canvasRectRaw ? {
      x: canvasRectRaw.x,
      y: canvasRectRaw.y,
      width: canvasRectRaw.width,
      height: canvasRectRaw.height,
      right: canvasRectRaw.right,
      bottom: canvasRectRaw.bottom,
    } : null;
    const gameSize = { width: scene.scale.gameSize.width, height: scene.scale.gameSize.height };
    const cssScaleX = canvasRect ? canvasRect.width / gameSize.width : 1;
    const cssScaleY = canvasRect ? canvasRect.height / gameSize.height : 1;
    const rectOf = object => {
      if (!object || !object.visible || !object.active || typeof object.getBounds !== "function") return null;
      const bounds = object.getBounds();
      const x = (canvasRect?.x ?? 0) + bounds.x * cssScaleX;
      const y = (canvasRect?.y ?? 0) + bounds.y * cssScaleY;
      const width = bounds.width * cssScaleX;
      const height = bounds.height * cssScaleY;
      return {
        name: object.name || object.type || "unnamed",
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
        right: Number((x + width).toFixed(2)),
        bottom: Number((y + height).toFixed(2)),
        worldRect: {
          x: Number(bounds.x.toFixed(2)),
          y: Number(bounds.y.toFixed(2)),
          width: Number(bounds.width.toFixed(2)),
          height: Number(bounds.height.toFixed(2)),
        },
      };
    };
    const viewport = { width: innerWidth, height: innerHeight };
    const insideViewport = rect => !rect || (rect.x >= -0.5 && rect.y >= -0.5 && rect.right <= viewport.width + 0.5 && rect.bottom <= viewport.height + 0.5);
    const overlapArea = (a, b) => {
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      return Number((width * height).toFixed(2));
    };
    const actionButtons = scene.actionButtons
      .map(button => ({ name: button.name, rect: rectOf(button.container) }))
      .filter(entry => entry.rect);
    const hudItems = [scene.resourceText, scene.objectiveText, scene.noticeText, scene.selectionText]
      .map(rectOf)
      .filter(Boolean);
    const roots = [scene.topRoot, scene.actionRoot, scene.rotateRoot]
      .map(rectOf)
      .filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < actionButtons.length; i += 1) {
      for (let j = i + 1; j < actionButtons.length; j += 1) {
        const area = overlapArea(actionButtons[i].rect, actionButtons[j].rect);
        if (area > 0.5) overlaps.push({ first: actionButtons[i].name, second: actionButtons[j].name, area });
      }
    }
    const outOfBounds = [
      ...roots.map(rect => ({ kind: "root", name: rect.name, rect })),
      ...hudItems.map(rect => ({ kind: "hud", name: rect.name, rect })),
      ...actionButtons.map(entry => ({ kind: "button", name: entry.name, rect: entry.rect })),
    ].filter(entry => !insideViewport(entry.rect));
    const bodyFitsViewport = document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
    const canvasFitsViewport = Boolean(canvasRect && canvasRect.x >= -0.5 && canvasRect.y >= -0.5 && canvasRect.right <= innerWidth + 0.5 && canvasRect.bottom <= innerHeight + 0.5);
    return {
      state: stateName,
      activeScenes,
      viewport,
      media: {
        landscape: matchMedia("(orientation: landscape)").matches,
        coarsePointer: matchMedia("(pointer: coarse)").matches,
      },
      body: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        fitsViewport: bodyFitsViewport,
      },
      canvasRect,
      canvasFitsViewport,
      gameSize,
      cssScale: { x: cssScaleX, y: cssScaleY },
      compactUi: scene.compactUi,
      uiScale: scene.uiScale,
      orientationBlocked: scene.orientationBlocked,
      buildMenuOpen: scene.buildMenuOpen,
      roots,
      hudItems,
      actionButtons,
      overlaps,
      outOfBounds,
      pass: activeScenes.length === 1 && activeScenes[0] === "VillageAssaultScene" && bodyFitsViewport && canvasFitsViewport && scene.compactUi === true && scene.orientationBlocked === false && overlaps.length === 0 && outOfBounds.length === 0,
    };
  }, state);

  const defaultLayout = await collectLayout("default");
  await page.screenshot({ path: `${outDir}/village-assault-mobile-844x390.png` });

  const workerSelectProxy = page.locator('[data-canvas-control="assault-action-1"]');
  const workerSelectLabel = await workerSelectProxy.getAttribute("aria-label");
  await workerSelectProxy.dispatchEvent("click");
  await page.waitForFunction(() => {
    const scene = globalThis.__VILLAGE_SIEGE_DEV_GAME__?.scene?.getScene("VillageAssaultScene");
    return Boolean(scene?.selectedIds?.size > 0);
  }, null, { timeout: 5000 });
  const buildProxy = page.locator('[data-canvas-control][aria-label="建造"]');
  await buildProxy.waitFor({ state: "attached", timeout: 5000 });
  const buildLabel = await buildProxy.getAttribute("aria-label");
  await buildProxy.dispatchEvent("click");
  await page.waitForFunction(() => globalThis.__VILLAGE_SIEGE_DEV_GAME__?.scene?.getScene("VillageAssaultScene")?.buildMenuOpen === true, null, { timeout: 5000 });
  const menuOpenResult = await page.evaluate(({ workerSelectLabel, buildLabel }) => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game.scene.getScene("VillageAssaultScene");
    return {
      opened: scene.buildMenuOpen === true,
      activeScenes: game.scene.getScenes(true).map(activeScene => activeScene.scene.key),
      selectedCount: scene.selectedIds.size,
      interaction: {
        workerSelectProxy: "assault-action-1",
        workerSelectLabel,
        buildLabel,
        method: "Playwright dispatchEvent(click) on live accessibility proxies",
      },
    };
  }, { workerSelectLabel, buildLabel });
  await page.waitForTimeout(300);
  const buildMenuLayout = await collectLayout("build-menu");
  await page.screenshot({ path: `${outDir}/village-assault-build-menu-844x390.png` });

  const sceneAssetFailures = await page.evaluate(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    return game.scene.getScenes(false).map(scene => ({
      scene: scene.scene.key,
      artLoadFailures: Array.isArray(scene.artLoadFailures) ? [...scene.artLoadFailures] : [],
    })).filter(entry => entry.artLoadFailures.length > 0);
  });
  const errors = {
    generatedAt: new Date().toISOString(),
    pageErrors,
    consoleErrors,
    requestFailures,
    sceneAssetFailures,
    pass: pageErrors.length === 0 && consoleErrors.length === 0 && requestFailures.length === 0 && sceneAssetFailures.length === 0,
  };
  await saveJson("browser-error-audit.json", errors);
  await saveJson("village-assault-mobile-844x390.json", {
    generatedAt: new Date().toISOString(),
    targetViewport: { width: 844, height: 390 },
    menuOpenResult,
    defaultLayout,
    buildMenuLayout,
    pass: Boolean(menuOpenResult.opened && defaultLayout.pass && buildMenuLayout.pass),
  });

  return {
    assetPass: assetResults.every(result => result.pass),
    defaultLayoutPass: defaultLayout.pass,
    menuOpened: menuOpenResult.opened,
    buildMenuLayoutPass: buildMenuLayout.pass,
    errorAuditPass: errors.pass,
    counts: {
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      requestFailures: requestFailures.length,
      sceneAssetFailures: sceneAssetFailures.length,
    },
  };
}
