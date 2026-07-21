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

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => globalThis.__VILLAGE_SIEGE_DEV_GAME__?.isBooted === true, null, { timeout: 20000 });
  await page.evaluate(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const activeScene = game.scene.getScenes(true)[0];
    const data = {
      villageId: "pinehold",
      aiPersonality: "balanced",
      returnScene: "VillageSelectScene",
    };
    if (activeScene) activeScene.scene.start("CombatShowcaseScene", data);
    else game.scene.start("CombatShowcaseScene", data);
  });
  await page.waitForFunction(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game?.scene?.getScene("CombatShowcaseScene");
    return Boolean(game?.scene?.isActive("CombatShowcaseScene") && scene?.actors?.some(actor => actor.artId === "shieldbearer" && actor.team === "player"));
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const briefingButton = page.getByRole("button", { name: "開始指揮", exact: true });
  const briefingButtonCount = await briefingButton.count();
  if (briefingButtonCount > 0) {
    await briefingButton.dispatchEvent("click");
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "開始指揮" && !button.hidden), null, { timeout: 5000 });
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game.scene.getScene("CombatShowcaseScene");
    scene.scene.pause();
  });

  const matrix = await page.evaluate(() => {
    const facings = ["e", "ne", "nw", "w", "sw", "se"];
    const actions = ["idle", "walk", "attack", "hurt", "death", "cast"];
    const expectedRows = { idle: 0, walk: 1, attack: 2, hurt: 3, death: 4, cast: 5 };
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    const scene = game.scene.getScene("CombatShowcaseScene");
    const shieldbearer = scene.actors.find(actor => actor.artId === "shieldbearer" && actor.team === "player");
    if (!shieldbearer) throw new Error("Player shieldbearer was not found in CombatShowcaseScene");
    const visual = shieldbearer.visual;
    const manifest = visual.manifest;
    const results = [];
    for (const facing of facings) {
      for (const action of actions) {
        visual.setFacing(facing);
        visual.play(action, true);
        const beforeSnapshot = { ...visual.snapshot };
        const beforeFrame = visual.image.frame;
        const before = {
          snapshot: beforeSnapshot,
          textureKey: visual.image.texture.key,
          frameName: beforeFrame.name,
          frameCutX: beforeFrame.cutX,
          frameCutY: beforeFrame.cutY,
          frameRow: beforeFrame.cutY / manifest.frameHeight,
          flipX: visual.image.flipX,
        };
        const rowDefinition = manifest.actions[action];
        visual.update(1000 / rowDefinition.fps + 1);
        const afterSnapshot = { ...visual.snapshot };
        const afterFrame = visual.image.frame;
        const after = {
          snapshot: afterSnapshot,
          textureKey: visual.image.texture.key,
          frameName: afterFrame.name,
          frameCutX: afterFrame.cutX,
          frameCutY: afterFrame.cutY,
          frameRow: afterFrame.cutY / manifest.frameHeight,
          flipX: visual.image.flipX,
        };
        const expectedTextureKey = `unit-action-sheet-shieldbearer-${facing}`;
        const expectedRow = expectedRows[action];
        const checks = {
          initialFacingMatches: before.snapshot.facing === facing,
          advancedFacingMatches: after.snapshot.facing === facing,
          initialActionMatches: before.snapshot.action === action,
          advancedActionMatches: after.snapshot.action === action,
          textureKeyMatches: before.textureKey === expectedTextureKey && after.textureKey === expectedTextureKey,
          rowMatches: before.frameRow === expectedRow && after.frameRow === expectedRow,
          frameAdvanced: after.snapshot.frame > before.snapshot.frame && after.frameName !== before.frameName,
          flipXDisabled: before.flipX === false && after.flipX === false,
        };
        results.push({
          facing,
          action,
          expectedTextureKey,
          expectedRow,
          rowDefinition: { row: rowDefinition.row, frames: rowDefinition.frames, fps: rowDefinition.fps, loop: rowDefinition.loop },
          before,
          after,
          checks,
          pass: Object.values(checks).every(Boolean),
        });
      }
    }
    return {
      activeScenes: game.scene.getScenes(true).map(activeScene => activeScene.scene.key),
      briefingDismissed: ![...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "開始指揮" && !button.hidden),
      actor: { instanceId: shieldbearer.instanceId, artId: shieldbearer.artId, team: shieldbearer.team },
      manifest: {
        id: manifest.id,
        frameWidth: manifest.frameWidth,
        frameHeight: manifest.frameHeight,
        directionalTextureKeys: manifest.directionalTextureKeys,
      },
      expectedStateCount: facings.length * actions.length,
      observedStateCount: results.length,
      passedStateCount: results.filter(result => result.pass).length,
      failedStateCount: results.filter(result => !result.pass).length,
      pass: game.scene.getScenes(true).length === 1 && game.scene.getScenes(true)[0].scene.key === "CombatShowcaseScene" && ![...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "開始指揮" && !button.hidden) && results.length === 36 && results.every(result => result.pass),
      results,
    };
  });
  await saveJson("shieldbearer-runtime-facing-action-matrix.json", {
    generatedAt: new Date().toISOString(),
    scene: "CombatShowcaseScene",
    ...matrix,
  });

  const setRepresentativeState = async (facing, action, stepFrame) => {
    return await page.evaluate(({ facing, action, stepFrame }) => {
      const scene = globalThis.__VILLAGE_SIEGE_DEV_GAME__.scene.getScene("CombatShowcaseScene");
      const shieldbearer = scene.actors.find(actor => actor.artId === "shieldbearer" && actor.team === "player");
      const visual = shieldbearer.visual;
      visual.setFacing(facing);
      visual.play(action, true);
      if (stepFrame) visual.update(1000 / visual.manifest.actions[action].fps + 1);
      scene.cameras.main.centerOn(visual.container.x, visual.container.y);
      return {
        facing,
        action,
        textureKey: visual.image.texture.key,
        frameName: visual.image.frame.name,
        frame: visual.snapshot.frame,
        flipX: visual.image.flipX,
      };
    }, { facing, action, stepFrame });
  };

  const representatives = [];
  representatives.push(await setRepresentativeState("e", "attack", true));
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/shieldbearer-runtime-e-attack-frame1.png` });
  representatives.push(await setRepresentativeState("nw", "walk", true));
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/shieldbearer-runtime-nw-walk-frame1.png` });
  representatives.push(await setRepresentativeState("se", "cast", true));
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${outDir}/shieldbearer-runtime-se-cast-frame1.png` });

  const sceneAssetFailures = await page.evaluate(() => {
    const game = globalThis.__VILLAGE_SIEGE_DEV_GAME__;
    return game.scene.getScenes(false).map(scene => ({
      scene: scene.scene.key,
      artLoadFailures: Array.isArray(scene.artLoadFailures) ? [...scene.artLoadFailures] : [],
    })).filter(entry => entry.artLoadFailures.length > 0);
  });
  const errorAudit = {
    generatedAt: new Date().toISOString(),
    pageErrors,
    consoleErrors,
    requestFailures,
    sceneAssetFailures,
    pass: pageErrors.length === 0 && consoleErrors.length === 0 && requestFailures.length === 0 && sceneAssetFailures.length === 0,
  };
  await saveJson("shieldbearer-runtime-error-audit.json", errorAudit);
  await saveJson("shieldbearer-runtime-representative-states.json", {
    generatedAt: new Date().toISOString(),
    representatives,
  });

  return {
    matrixPass: matrix.pass,
    observedStateCount: matrix.observedStateCount,
    passedStateCount: matrix.passedStateCount,
    failedStateCount: matrix.failedStateCount,
    representativeCount: representatives.length,
    errorAuditPass: errorAudit.pass,
    errorCounts: {
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      requestFailures: requestFailures.length,
      sceneAssetFailures: sceneAssetFailures.length,
    },
  };
}
