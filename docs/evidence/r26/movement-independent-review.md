# R26 movement integration independent review

Date: 2026-10-02

Scope: read-only review of `unitMotionPresentation.ts`, the local unit/monster movement integration in `VillageAssaultScene.ts`, save/replay import replacement, actor action/facing/depth updates, online interpolation separation, and `battleObjectives.ts`. I did not edit Scene, shared simulation rules, map data, or objective code. This review did not include browser play, video capture, touch-device testing, or visual frame-by-frame comparison.

## Findings

### R26-MOV-01 — Medium: pending lazy art freezes all existing local motion and animation

`VillageAssaultScene.update()` returns at lines 680–682 whenever `visibleArtPending.size` is nonzero. That happens before `updateLocalMotion`, `updateUnitAnimations`, and `runtime.step` at lines 684–686. A slow non-core actor download therefore freezes every already-visible unit in place and stops their leg phase for the whole download, then resumes later. This is likely visible as a hard pause, especially on a cold network, and weakens the intended continuous movement presentation.

Suggested bounded resolution: make the loading state explicit if simulation must pause, or continue display motion/animation for existing actors while the runtime is held. Do not advance the simulation while selectively omitting entities unless the missing-view lifecycle is made safe.

### R26-OBJ-01 — Medium: scout waypoint validation fails open for an unexpected map id

`battleObjectives.ts:132–134` returns `true` from `publicMapPassable` whenever `snapshot.map.id !== "villageAssault"`. The objective panel is currently used by Village Assault, but this fallback means a mismatched/corrupt/future snapshot can produce an `attackMove` waypoint using only rectangular bounds, without a public passability source. It does not expose a hidden enemy id, but it can issue an invalid objective command and violates the stated static-public-map constraint.

Suggested bounded resolution: return `false` for unsupported map ids and omit the scout action. Add a test with a non-`villageAssault` id and another with an invalid layout id.

## Confirmed behavior

- The earlier save/replay import stale-tick issue is resolved in the reviewed tree. On `initial=true`, `setLocalMotionTarget` now creates a fresh presenter at the imported target and imported tick (`VillageAssaultScene.ts:1416–1420`), clears `lastMoveTick`, and places the actor there. It no longer reuses a presenter whose newer tick would reject an older imported target.
- Normal target refreshes do not snap or restart travel. `UnitMotionPresentation.setAuthoritativeTarget` rejects only older ticks, preserves the display position, and keeps speed for a same-position refresh. A changed authoritative target continues from the current displayed position.
- A local target jump greater than two grid cells uses an explicit correction snap (`VillageAssaultScene.ts:1428–1429`). Windup/commit correction is bounded to approximately 100 ms through an effective presentation speed. Neither path changes canonical position, speed, terrain cost, or hashes.
- Local movement is advanced once per render update. Online entities do not use `UnitMotionPresentation`; they remain on `OnlineAssaultMatchSource` presentation positions (`applyOnlinePresentation`), so the reviewed integration does not add a second network interpolation layer.
- Unit and monster depth follows the displayed Y coordinate every local motion update (`VillageAssaultScene.ts:1434–1438`). Sync-time depth also uses the actor's current displayed Y, avoiding a target-position depth jump.
- Walk animation is not restarted on every snapshot: `actor.play` runs only when action changes or for explicit hurt/combat transitions. `view.motion.moving` keeps the final grid step in walk until the presenter arrives. Arrival can remain visually in walk until the next simulation sync, bounded by the normal simulation tick; this was not judged a material defect without play evidence.
- `faceVector` is followed by authoritative `entity.facing`. This makes authoritative facing the final direction and prevents display smoothing from inventing a turn. Six-direction sheets remain unmirrored; the single-sheet east/west fallback is separate and does not claim six authored views.
- Objectives select an enemy town center only when its id is in `visibleEntityIds`, its owner belongs to a hostile team, and it is alive. Hidden entities and stale sightings are not converted into attack targets. Scout actions use owned, alive military ids only.

## Verification

Focused command:

`npx vitest run test/unitMotionPresentation.test.ts test/battleObjectives.test.ts --no-file-parallelism`

Result: 2 test files passed, 14 tests passed. These deterministic tests cover presenter continuity/stale ticks and hidden-enemy objective filtering. They do not replace actual rendered play or recording QA.

## Revalidation — 2026-10-02

The original findings above are retained as review history.

- **R26-MOV-01 resolved in source:** while `visibleArtPending` holds the canonical offline simulation, the branch now advances `updateLocalMotion` and `updateUnitAnimations` before returning. Existing displayed actors therefore keep moving to their last authoritative target and keep their authored animation phase. The appended `output[role=status]` explicitly says that the single-player match is paused while a newly visible actor downloads.
- **R26-OBJ-01 resolved in source:** `publicMapPassable` now returns `false` for every unsupported map id. The existing unsupported-map test passes. This revalidation adds an invalid-layout test and confirms that an invalid `villageAssault` layout also yields no scout action.
- **Imported-motion stale tick remains resolved:** `initial=true` replaces the presenter using the imported target and tick rather than refreshing a newer presenter.

### R26-LOAD-01 — Medium: continue save is cleared before all fallible battle UI setup completes

`retryBattleLoading` correctly passes `continueSaveJson` into `scene.restart`, and `prepareOfflineRuntime` retains it across preload and imports it before `initialBattleArtIds` is computed. This protects a failed preload and the early part of `createBattle`.

However, `createBattle` currently sets `battleStarted = true` and clears `continueSaveJson` before it creates the visible-art status output, worker panel, objectives panel, final layout, autosave timer, and loading cleanup. If any of those later setup calls throws, the outer `create()` catch sets `battleStarted` back to false and exposes retry, but retry no longer has the original save JSON. The restarted scene can therefore start a new match rather than retrying the saved match.

Suggested bounded resolution: clear `continueSaveJson` only after all synchronous battle setup that can throw has completed, immediately before or after successful loading cleanup. Keep `battleStarted` ordering compatible with the first autosave call.

### R26-LOAD-02 — Low: initial art selection does not enforce `visibleEntityIds`

`initialBattleArtIds` scans every entity in `VisibleSnapshot.entities` and does not intersect with `visibleEntityIds`, despite its contract saying that blocking downloads cover only entities in the recipient's starting view. All genuinely visible units and monsters are therefore covered, so no missing-visible-actor creation path was found: initial actor creation validates preloaded visible art, and later appearances go through `requestVisibleArt` before actor creation.

The broader scan can still preload a hidden enemy or monster art type when an allowed snapshot contains an entity excluded from `visibleEntityIds`. That increases initial bytes and can create a resource-download side channel. Filter the helper by `visibleEntityIds` and retain a test where a hidden entity is present in `entities` but absent from the visible id set.

Revalidation command:

`npx vitest run test/unitMotionPresentation.test.ts test/battleObjectives.test.ts --no-file-parallelism`

Result: 2 test files passed, 16 tests passed. `npm run typecheck --workspace @village-siege/client` also passed. Browser retry interaction, forced late setup failure, network throttling, and recorded play remain outside this bounded revalidation.

## Final revalidation — 2026-10-02

Final source freeze review confirms the two later loading findings are resolved:

- **R26-LOAD-01 resolved:** retry continues to forward `continueSaveJson`, and the value is now cleared only after the remaining synchronous setup and `cleanupBattleLoading` complete. A preload or setup failure retains the original save for retry.
- **R26-LOAD-02 resolved:** `initialBattleArtIds` now includes only the recipient's own entities or ids explicitly present in `visibleEntityIds`. The focused test covers hidden hostile unit and monster kinds; visible restored actors remain included, while later appearances still use the deferred `requestVisibleArt` path.
- **Slow-step presentation revalidated:** the observed interval upper bound is now `max(1200 ms, defaultStepMs × 2)`. Units or monsters with roughly 0.62–0.68 tile/s cadence are no longer forced through the old 1200 ms cap to arrive early and wait at each target. This remains presentation-only and does not alter authoritative movement speed or terrain cost.

Final focused command:

`npx vitest run test/unitMotionPresentation.test.ts test/battleObjectives.test.ts test/initialBattleArt.test.ts --no-file-parallelism`

Result: 3 test files passed, 19 tests passed. Client typecheck passed. No unresolved finding remains within this bounded source review. Browser play, forced retry failure injection, network throttling, touch hardware, and recorded motion QA were not performed here.
