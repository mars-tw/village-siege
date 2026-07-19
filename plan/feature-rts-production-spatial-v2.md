---
goal: Authoritative Spatial Rules and Specialized Production Buildings
version: 2.0.0
date_created: 2026-07-19
last_updated: 2026-07-19
owner: Village Siege production team
status: 'Complete'
tags: [feature, game, rts, pathfinding, construction, production, ai, mobile]
---

# Introduction

![Status: Complete](https://img.shields.io/badge/status-Complete-brightgreen)

This plan upgrades the released economy-assault slice into a more legible classic RTS village. Shared rules shall authoritatively validate multi-tile building footprints and route units around structures. Five original production buildings shall separate ranged, magical, firearm, mounted and siege training while preserving a fixed seven-slot mobile command dock and the frontier-survey visual identity.

## 1. Requirements & Constraints

- **REQ-001**: `@village-siege/shared` shall be the only authority for footprint bounds, structure/resource overlap, producer eligibility, unit movement and deterministic path selection.
- **REQ-002**: `BuildingDefinition` shall declare immutable footprint offsets for every `BuildingType`; the client shall render placement cells from the same definition.
- **REQ-003**: Units shall use deterministic four-direction pathfinding around occupied structure/resource cells without mutating replay order or random state.
- **REQ-004**: The building roster shall add `archeryRange`, `mageSanctum`, `gunWorkshop`, `beastStable` and `siegeWorkshop` with distinct costs, construction times, health and training roles.
- **REQ-005**: `barracks` shall train militia and spearman; each added production building shall train its matching advanced unit class.
- **REQ-006**: All five AI personalities shall be able to gather required resources, build a legal producer, train a valid unit and advance toward the enemy.
- **REQ-007**: The landscape touch command dock shall expose every building and trained unit through paged seven-slot panels with a stable Back/System position and no overlap at 568x320.
- **REQ-008**: Placement mode shall render every footprint cell with color plus cross/check shape semantics and reject terrain, reserved route, boundary and authoritative entity collisions before issuing a command.
- **REQ-009**: Unit action sheets shall load on demand before a newly requested art type is displayed; missing art shall stop the action with a visible recovery path and shall never render primitive actors.
- **CON-001**: Do not copy Age of Empires assets, UI trade dress, building silhouettes, audio, names or map layouts.
- **CON-002**: Match state hashes and identical command streams shall remain deterministic after the spatial upgrade.
- **CON-003**: Existing public save/replay compatibility is not required because no persistent match format has been released, but `RULES_VERSION` shall change to `village-siege/0.2.0`.
- **CON-004**: The first contentful game screen shall not download advanced unit action sheets that are absent from the initial match.
- **GUD-001**: Use the existing fixed 10 Hz simulation tick; pathfinding shall operate on integer grid cells only.
- **GUD-002**: Preserve the frontier-survey palette: pine ink `#101917`, copper `#E0B866`, limewash `#C4B88E`, river teal `#356B78`, paper `#F0EBCF`.
- **GUD-003**: The visual signature shall be a copper survey overlay that shows the complete building footprint, occupied cells and reserved breach route before placement.
- **PAT-001**: UI code shall issue `CommandEnvelope` values and shall not directly mutate wallets, queues, hit points, positions or construction state.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Implement deterministic shared spatial authority and regression tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add pure footprint and deterministic BFS utilities in `packages/shared/src/spatial.ts` with boundary, overlap, blocked-target and unreachable tests in `packages/shared/src/spatial.test.ts`. | Yes | 2026-07-19 |
| TASK-002 | Extend `BuildingDefinition` in `packages/shared/src/content.ts` with immutable footprint offsets and update every building definition. | Yes | 2026-07-19 |
| TASK-003 | Update `validateGameCommand`, `moveToward`, `updateTraining` and spawn placement in `packages/shared/src/simulation.ts` to use shared footprint occupancy and pathfinding. | Yes | 2026-07-19 |
| TASK-004 | Add deterministic replay, multi-cell overlap, boundary, movement detour and non-overlapping unit-spawn tests in `packages/shared/src/simulation.test.ts`. | Yes | 2026-07-19 |

### Implementation Phase 2

- GOAL-002: Add specialized production buildings and AI progression.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Extend `BuildingType`, validators, `BUILDINGS` and `UNITS[*].producers` for the five specialized producers and change `RULES_VERSION` to `village-siege/0.2.0`. | Yes | 2026-07-19 |
| TASK-006 | Update `packages/shared/src/ai.ts` so personalities choose an affordable desired unit, ensure its producer exists or is under construction, gather fallback resources and only train from valid completed producers. | Yes | 2026-07-19 |
| TASK-007 | Add long-run tests proving all five AI personality paths construct a valid producer, train a matching unit and execute their movement policy without rejected commands. | Yes | 2026-07-19 |

### Implementation Phase 3

- GOAL-003: Integrate original building art, footprint placement and mobile-safe production panels.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Extend `apps/client/src/game/villageAssaultArt.ts` with original readable silhouettes and construction/damage/queue states for all five producers. | Yes | 2026-07-19 |
| TASK-009 | Replace the single-cell placement preview in `villageAssaultMap.ts` and `VillageAssaultScene.ts` with shared footprint cells and client terrain/reserved-route validation. | Yes | 2026-07-19 |
| TASK-010 | Add three paged seven-slot build panels and contextual producer panels in `VillageAssaultScene.ts`; preserve System and Back positions and 44x44 CSS minimum targets at 568x320. | Yes | 2026-07-19 |
| TASK-011 | Add manifest-aware action-sheet loading that queues a train action until the required sheet is ready and displays a recoverable loading error on failure. | Yes | 2026-07-19 |
| TASK-012 | Update in-game labels, `README.md` and `docs/BEGINNER_GUIDE.zh-TW.md` for v2 buildings, unit producers and footprint controls. | Yes | 2026-07-19 |

### Implementation Phase 4

- GOAL-004: Audit, publish and verify the v2 release.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Run `npm run verify`, multiplayer lobby smoke and `git diff --check`; fix all failures. | Yes | 2026-07-19 |
| TASK-014 | Use Playwright CLI to verify desktop and 568x320 three-page build controls, lazy art requests, System, minimum touch targets and portrait blocker flows. | Yes | 2026-07-19 |
| TASK-015 | Run Grok CLI read-only audit, fix every P0/P1 and write the final report in `docs/audits/`. | Yes | 2026-07-19 |
| TASK-016 | Commit, push, open and merge a pull request, wait for GitHub Pages and verify the public JS plus every advanced action sheet returns HTTP 200. | Yes | 2026-07-19 |

## 3. Alternatives

- **ALT-001**: Keep every military unit in `barracks`; rejected because producer choice and village layout would remain shallow.
- **ALT-002**: Implement continuous navmeshes; rejected because the authoritative simulation and replay format are integer-grid based.
- **ALT-003**: Let the client own footprint legality; rejected because local preview and authoritative command acceptance can diverge.
- **ALT-004**: Download all action sheets in scene preload; rejected because the seven large sheets delay mobile startup and produced the released bundle-size warning.

## 4. Dependencies

- **DEP-001**: Existing `@village-siege/shared` protocol, content, AI and simulation modules.
- **DEP-002**: Existing Phaser isometric map, frame animation manifest, Canvas button and device viewport modules.
- **DEP-003**: Existing GitHub Pages workflow and public original unit action sheets.

## 5. Files

- **FILE-001**: `packages/shared/src/spatial.ts` and `spatial.test.ts` - footprint geometry and deterministic pathfinding.
- **FILE-002**: `packages/shared/src/protocol.ts` and `content.ts` - v2 building roster, definitions, producers and rules version.
- **FILE-003**: `packages/shared/src/simulation.ts` and `simulation.test.ts` - authoritative placement, movement and spawn integration.
- **FILE-004**: `packages/shared/src/ai.ts` and `ai.test.ts` - specialized producer progression.
- **FILE-005**: `apps/client/src/game/villageAssaultArt.ts` - original specialized building art.
- **FILE-006**: `apps/client/src/game/villageAssaultMap.ts` - multi-cell copper survey overlay and terrain validation.
- **FILE-007**: `apps/client/src/scenes/VillageAssaultScene.ts` - paged construction/production UI and lazy unit art.
- **FILE-008**: `README.md` and `docs/BEGINNER_GUIDE.zh-TW.md` - v2 player documentation.
- **FILE-009**: `audit/village-rts-v2-grok-audit-2026-07-19.md` - independent release audit.

## 6. Testing

- **TEST-001**: Every footprint cell is inside the map and no two non-unit entities overlap after match creation and accepted build commands.
- **TEST-002**: A 2x2 building is rejected when any cell crosses the map boundary or overlaps a resource/building footprint.
- **TEST-003**: A unit routes around a 2x2 obstacle deterministically and identical command streams produce identical state hashes.
- **TEST-004**: Completed training spawns a unit on the nearest deterministic unblocked perimeter cell.
- **TEST-005**: Each advanced unit is rejected at the wrong producer and accepted at its declared completed producer.
- **TEST-006**: AI long runs contain no rejected commands and produce both a specialized building and matching unit before advancing.
- **TEST-007**: At 568x320, all build types and all producer actions are reachable, controls do not overlap and each visible action slot is at least 44x44 CSS pixels.
- **TEST-008**: Initial network requests omit advanced action sheets; selecting a producer or training an advanced unit loads only the required missing sheet before display.
- **TEST-009**: Public Pages HTML, hashed JS and all seven unit action sheets return HTTP 200 after deployment.

## 7. Risks & Assumptions

- **RISK-001**: BFS per moving unit can increase CPU cost; the 18x16 grid is bounded and deterministic occupancy sets shall be reused within each simulation tick where practical.
- **RISK-002**: Multi-cell structures can block the central route; shared placement plus the client reserved-route rule shall prevent sealing the breach in this version.
- **RISK-003**: Ten build actions exceed one mobile page; three stable pages and explicit Back/Next/Home actions mitigate discoverability risk.
- **RISK-004**: On-demand texture loading can race repeated train taps; one promise per texture key and disabled pending actions shall coalesce requests.
- **ASSUMPTION-001**: This version remains a single-player economy-assault release; server-authoritative multiplayer combat remains a later milestone.
- **ASSUMPTION-002**: Existing unit action-sheet art remains approved and no new bitmap generation is required for the five vector-rendered building silhouettes.

## 8. Related Specifications / Further Reading

[Village economy and assault v1 plan](feature-village-economy-assault-1.md)

[Classic RTS village assault quality gates](../spec/spec-design-classic-rts-village-assault-quality-gates.md)

[Beginner guide](../docs/BEGINNER_GUIDE.zh-TW.md)
