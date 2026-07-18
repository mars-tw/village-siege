# Grok CLI frame-animation and map review

Date: 2026-07-17 17:35 (Asia/Taipei)
Reviewer: Grok CLI 0.2.101
Mode: evidence-only peer review; no repository writes or external web access

## Verdict

**GO** for replacing the single-image sway presentation and removing the visible tile grid.

## Review findings

- Continuous grass, road, river and prop rendering replaces per-tile diamond outlines, while `MAP_ROWS`, terrain lookup, walkable clamping and A* remain.
- Seven player units and three monsters each ship a 1024×1536, 4-column × 6-row action sheet.
- The asset contract and runtime agree on `idle`, `walk`, `attack`, `cast`, `hurt`, `death`, four authored frames per row and 256×256 cells.
- `BootScene` preloads every required unit and monster action sheet and blocks startup when a required sheet fails.
- `CombatShowcaseScene` creates units and monsters through `createFrameAnimatedCombatActor` and `requireFrameAnimatedManifest`; there is no combat-scene fallback to a portrait-sway actor.
- The runtime advances real crop frames by FPS, mirrors left facings, restarts non-loop actions and returns completed non-death actions to idle.
- TypeScript, 28 shared tests, the production client build, Playwright walk/cast frame captures and a clean browser console support release of this rework.

## Honest remaining limitation

Six logical facings currently share one authored right-facing sheet with horizontal mirroring. Six separately painted directional sheets are still a future art-production milestone; this does not block the completed replacement of fake sway animation or the gridless-map rework.
