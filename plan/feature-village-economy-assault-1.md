---
goal: Playable Village Economy and Assault Loop
version: 1.0
date_created: 2026-07-19
last_updated: 2026-07-19
owner: Village Siege production team
status: 'In progress'
tags: [feature, game, economy, construction, training, ai, mobile]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

This plan connects the existing deterministic shared RTS simulation to a new primary Phaser village-assault scene. The finished slice shall let a player gather food, wood and stone; construct a house, economy buildings, barracks and tower; train workers and military units; defend a settlement; and destroy the enemy command hall through desktop or landscape-touch controls.

## 1. Requirements & Constraints

- **REQ-001**: `packages/shared/src/simulation.ts` shall remain the only authority for resources, population, construction, training, damage and conquest state.
- **REQ-002**: The playable loop shall include resource gathering, visible resource depletion, building placement, construction progress, training queues, population blocking and command-hall conquest.
- **REQ-003**: Player actions shall expose select, gather, build, train, move, attack, pause, restart and leave without page scrolling.
- **REQ-004**: The opponent shall gather, construct, train and attack with observable timing differences for all five `AiPersonality` values.
- **REQ-005**: Runtime unit art shall reuse the approved action sheets and shall not fall back to primitive humanoid placeholders.
- **REQ-006**: Runtime building and resource art shall use an original frontier-worksite visual system with readable silhouettes, construction states and health feedback.
- **REQ-007**: The single-player action from `VillageSelectScene` shall start the new village-assault scene while the existing combat showcase remains available as a code path for comparison and regression.
- **CON-001**: Do not copy Age of Empires II assets, names, interface layouts, map layouts, sounds or trade dress.
- **CON-002**: Required validation viewports are 568x320, 667x375, 844x390, 390x844 and 1366x1024 touch.
- **CON-003**: Primary touch targets shall remain at least 44x44 CSS pixels and respect safe-area insets.
- **GUD-001**: Use a fixed 10 Hz shared simulation tick and interpolate rendering independently.
- **GUD-002**: Keep new economy, art, AI and scene-controller responsibilities in separate modules; do not add the entire feature to `CombatShowcaseScene.ts`.
- **PAT-001**: Commands shall be created as `CommandEnvelope` values and passed through `validateCommand`, `applyCommand` or `stepSimulation`; UI code shall not mutate wallets, queues or hit points directly.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Extend the deterministic match bootstrap for a two-base assault map and prove the complete economy rule loop.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add optional per-player spawn overrides to `CreateInitialStateOptions` in `packages/shared/src/simulation.ts`; clamp overrides and preserve current defaults. | Yes | 2026-07-19 |
| TASK-002 | Add deterministic tests in `packages/shared/src/simulation.test.ts` for gathering, house construction, population increase, barracks construction, training and command-hall damage. | Yes | 2026-07-19 |
| TASK-003 | Add `apps/client/src/game/villageAssaultRuntime.ts` as the scene adapter for the shared AI controller and authoritative `MatchState`, with independent player/AI command sequences. | Yes | 2026-07-19 |

### Implementation Phase 2

- GOAL-002: Build an original isometric village, resource and structure presentation over the shared state.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Add `apps/client/src/game/villageAssaultMap.ts` to draw player and enemy work yards, buildable clearings, resource groves, quarry marks, crop plots, roads and the central breach route over the existing continuous battle terrain. | Yes | 2026-07-19 |
| TASK-005 | Add `apps/client/src/game/villageAssaultArt.ts` with renderers for town center, house, lumber camp, farmstead, barracks, defense tower, food, wood and stone; expose health, construction and queue indicators. | Yes | 2026-07-19 |
| TASK-006 | Map shared `UnitType` values to approved `CombatArtId` action sheets and add a worker tool marker without replacing the animated source character. | Yes | 2026-07-19 |

### Implementation Phase 3

- GOAL-003: Implement the primary playable village-assault scene and control surfaces.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Add `apps/client/src/scenes/VillageAssaultScene.ts` with lazy art loading, fixed-step command processing, interpolated entity views, selection, gather, move, attack, building placement, training, restart, pause and conquest result. | Yes | 2026-07-19 |
| TASK-008 | Add a fixed Canvas command dock with contextual main, build, train and system panels; synchronize accessible proxy visibility and labels through `CanvasButtonControl`. | Yes | 2026-07-19 |
| TASK-009 | Update `apps/client/src/scenes/VillageSelectScene.ts` and `apps/client/src/game/createGame.ts` so the primary single-player route starts `VillageAssaultScene` with the selected village and AI profile. | Yes | 2026-07-19 |
| TASK-010 | Update `README.md`, the beginner guide and the public limitation text to describe only completed economy and assault behavior. | Yes | 2026-07-19 |

### Implementation Phase 4

- GOAL-004: Validate, audit and publish the vertical slice.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Run typecheck, shared tests, production build and multiplayer lobby smoke; fix all regressions. | Yes | 2026-07-19 |
| TASK-012 | Use Playwright CLI for desktop, compact landscape, portrait selection and large-touch flows; verify gather, build, train, attack, restart, console and asset requests. | Yes | 2026-07-19 |
| TASK-013 | Run Grok CLI with read-only tools against the completed branch, fix every P0/P1 and record the final verdict in `audit/`. | Yes | 2026-07-19 |
| TASK-014 | Commit, open a pull request, merge, wait for Pages deployment and verify the public game path. | | |

## 3. Alternatives

- **ALT-001**: Revive `MatchScene.ts`; rejected because it duplicates combat rules, uses primitive actor art and depends on the removed DOM HUD registry.
- **ALT-002**: Add economy state directly inside `CombatShowcaseScene.ts`; rejected because it creates a second resource authority and expands an already large scene.
- **ALT-003**: Generate a complete bitmap building atlas before gameplay integration; deferred because deterministic interaction and readable construction states are required first, while Phaser vector structures can meet the original visual direction at runtime scale.

## 4. Dependencies

- **DEP-001**: Existing exports from `@village-siege/shared`, including `createInitialState`, `stepSimulation`, `validateCommand`, `BUILDINGS`, `UNITS` and protocol types.
- **DEP-002**: Existing Phaser action-sheet pipeline in `combatAnimationManifest.ts` and `frameAnimatedCombatActor.ts`.
- **DEP-003**: Existing continuous terrain, isometric conversion, Canvas button and device-viewport modules.

## 5. Files

- **FILE-001**: `packages/shared/src/simulation.ts` - spawn overrides and authoritative economy simulation.
- **FILE-002**: `packages/shared/src/simulation.test.ts` - deterministic end-to-end economy tests.
- **FILE-003**: `apps/client/src/game/villageAssaultRuntime.ts` - authoritative scene runtime and shared AI integration.
- **FILE-004**: `apps/client/src/game/villageAssaultMap.ts` - settlement and economy terrain dressing.
- **FILE-005**: `apps/client/src/game/villageAssaultArt.ts` - building and resource views.
- **FILE-006**: `apps/client/src/scenes/VillageAssaultScene.ts` - primary playable controller and Canvas UI.
- **FILE-007**: `apps/client/src/scenes/VillageSelectScene.ts` - single-player routing.
- **FILE-008**: `apps/client/src/game/createGame.ts` - scene registration.
- **FILE-009**: `README.md` and `docs/BEGINNER_GUIDE.zh-TW.md` - truthful user instructions.
- **FILE-010**: `audit/village-economy-assault-grok-audit-2026-07-19.md` - independent release audit.

## 6. Testing

- **TEST-001**: A worker gathers each resource type and the target resource amount decreases by the credited amount.
- **TEST-002**: Building validation rejects occupied, out-of-bounds and unaffordable placement.
- **TEST-003**: House completion increases population capacity; full capacity blocks training.
- **TEST-004**: Barracks completion enables military training and produces the requested unit after the declared ticks.
- **TEST-005**: Destroying a command hall starts the conquest grace rule and produces a finished match when the timer expires.
- **TEST-006**: Touch-only Playwright flow gathers wood, places a house, selects a producer, queues a unit and orders an attack without document overflow or overlapping controls.
- **TEST-007**: All runtime action sheets return 2xx and browser console project errors remain zero.
- **TEST-008**: Restart retains the selected village and AI personality while resetting resources, entities, queues and result state.

## 7. Risks & Assumptions

- **RISK-001**: The 18x16 battle grid can crowd two economies; fixed spawn overrides and reserved build zones mitigate the risk.
- **RISK-002**: Shared movement currently ignores building footprints and terrain costs; this vertical slice shall prevent invalid placement and reserve lanes, while full footprint pathfinding remains a subsequent quality gate.
- **RISK-003**: One approved action sheet is reused for the worker role; a tool marker and role label preserve readability until a dedicated worker sheet is authored.
- **RISK-004**: Mobile command depth can become menu-heavy; four mutually exclusive panels and a persistent context readout keep all operations in one fixed viewport.
- **ASSUMPTION-001**: This iteration targets a complete economy-to-conquest single-player vertical slice, not the full technology tree, fog of war or server-authoritative multiplayer combat.
- **ASSUMPTION-002**: Vector building art is acceptable for this gameplay milestone if it follows the established projection, materials, lighting and damage-state conventions.

## 8. Related Specifications / Further Reading

[Classic RTS village assault quality gates](../spec/spec-design-classic-rts-village-assault-quality-gates.md)

[Combat art rework specification](../spec/spec-design-combat-art-rework.md)

[Beginner guide](../docs/BEGINNER_GUIDE.zh-TW.md)
