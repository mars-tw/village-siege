---
goal: Build a playable open-source isometric village siege MVP with selectable AI and online multiplayer
version: 1.0.0
date_created: 2026-07-17
last_updated: 2026-07-17
owner: Village Siege Production Team
status: 'Planned'
tags: [feature, game, phaser, colyseus, multiplayer, artificial-intelligence, open-source]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan defines the complete implementation and gated production workflow for an original browser-based medieval village attack-and-defense game. The MVP uses a 2:1 isometric presentation, three playable village layouts with data capacity for five, five selectable opponent-AI profiles, authoritative Colyseus multiplayer, and an original HUD. The plan deliberately avoids copying Age of Empires II assets, names, interface composition, audio, maps, or other protected expression.

## 1. Requirements & Constraints

- **REQ-001**: Implement the browser client in TypeScript with Phaser and expose `createGame(config)` in `apps/client/src/game/createGame.ts` as the single game bootstrap function.
- **REQ-002**: Implement a deterministic 2:1 isometric map with tile coordinates converted by `tileToWorld(tileX, tileY)` and `worldToTile(worldX, worldY)` in `packages/shared/src/isometric/coordinates.ts`.
- **REQ-003**: Ship three distinct original village definitions in `packages/shared/src/content/villages.ts`: `pinehold` (「松林堡」), `riverstead` (「河谷鎮」), and `highcrag` (「高地寨」); the schema and selection UI must accept the reserved `marshwatch` and `sunfield` identifiers so the content pack can expand to five villages without code changes.
- **REQ-004**: Implement five selectable opponent-AI profiles named `aggressor`, `guardian`, `prosperer`, `balanced`, and `raider` in `apps/server/src/ai/profiles.ts`, corresponding respectively to 侵略者、守城者、繁榮者、均衡者及掠襲者; all AI decisions must be processed by the authoritative simulation.
- **REQ-005**: Implement the core loop of gathering wood, food, and stone; constructing exactly six building types—a town center, house, lumber camp, farmstead, barracks, and defensive tower; training exactly six unit types—villagers, militia, spearmen, archers, scouts, and battering rams; and winning by destroying all opposing town centers and preventing their reconstruction for 60 seconds.
- **REQ-006**: Implement offline single-player matches against one to four selected AI slots and online private-room matches for two to four human players, with optional AI-filled slots up to the map's village and five-faction limits.
- **REQ-007**: Implement room creation, join-by-code, readiness, match start, command validation, state synchronization, disconnect grace period, and reconnect through Colyseus; for multiplayer, the Colyseus room is the sole authority and clients submit intent only.
- **REQ-008**: Create original low-resolution medieval sprite sheets, terrain tiles, building silhouettes, unit silhouettes, icons, and HUD components under `apps/client/public/assets/original/`; every asset must have a corresponding entry in `assets/ATTRIBUTION.md`.
- **REQ-009**: Provide keyboard and pointer controls, remappable hotkeys, visible focus states, non-color-only status indicators, volume controls, and text alternatives for essential icon actions.
- **REQ-010**: Keep simulation rules, command schemas, content identifiers, and validation logic shared through `packages/shared` so the client can predict presentation without becoming authoritative.
- **REQ-011**: Execute all production work through three lines with exactly two workers, one supervisor, and one auditor per line, following the mandatory worker-to-supervisor-to-auditor sequence in `docs/production-workflow.md`; Plan Lines 1, 2, and 3 correspond to workflow Lines A, B, and C respectively.
- **REQ-012**: A line supervisor must approve the line deliverable before its auditor receives it; an auditor rejection returns the deliverable to the two workers through the supervisor.
- **REQ-013**: After audit approval, the auditor must produce a compressed handoff summary and then remove only run-scoped, reproducible one-time artifacts allowed by `docs/production-workflow.md`.
- **SEC-001**: Treat every client message as untrusted; `validateCommand(clientId, command, state)` in `apps/server/src/simulation/validateCommand.ts` must reject unknown schemas, ownership violations, impossible coordinates, unavailable resources, cooldown violations, and excessive command rates.
- **SEC-002**: The server must own random seeds, resources, damage, movement acceptance, construction progress, victory evaluation, and match time; clients may send intent only.
- **SEC-003**: Private room codes must be generated with cryptographically secure randomness, expire when a room closes, and never expose internal room identifiers or secrets in client logs.
- **SEC-004**: Continuous integration must run dependency audit, secret scanning, license allowlist validation, unit tests, integration tests, and browser smoke tests before a supervisor can approve a release candidate.
- **CON-001**: The MVP supports current desktop Chrome, Edge, and Firefox at viewport widths of 1280 pixels or greater; mobile interaction is outside MVP scope.
- **CON-002**: The active map supports at most 128 controllable units per player, four connected players, five village definitions, and a server simulation frequency of 10 ticks per second.
- **CON-003**: The target client budget is 60 rendered frames per second on a typical integrated-GPU desktop, an initial compressed download below 20 MB, and no more than 250 MB resident memory after a ten-minute four-player match.
- **CON-004**: All shipped source code and newly created assets must use licenses compatible with project distribution under MIT; third-party assets with unknown, noncommercial, no-derivatives, or attribution-incompatible terms are prohibited.
- **CON-005**: No implementation may reproduce proprietary Age of Empires II graphics, audio, text, maps, logos, unit names unique to that title, or pixel-identical interface layouts.
- **GUD-001**: Use seeded deterministic simulation updates through `stepSimulation(state, commands, deltaTicks)` in `apps/server/src/simulation/stepSimulation.ts`; do not use wall-clock time inside rule evaluation.
- **GUD-002**: Keep rendered sprites presentation-only and store authoritative entity state in serializable schemas so matches can be replayed from the seed and accepted command stream.
- **GUD-003**: Store tunable unit, building, village, and AI parameters as typed data tables rather than hard-coded scene logic.
- **PAT-001**: Use a monorepo with `apps/client`, `apps/server`, `packages/shared`, `assets`, `tests`, `docs`, `plan`, and `audit` as top-level implementation areas managed by one frozen lockfile.
- **PAT-002**: Use a gated handoff state machine of `WORKING -> SUPERVISOR_REVIEW -> AUDIT_REVIEW -> COMPRESSED_HANDOFF -> COMPLETE`; no transition may skip a state.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Establish the reproducible monorepo, deterministic shared contracts, original art direction, and automated quality gates required by all production lines.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Line 1 Worker A creates `apps/client/package.json`, `apps/client/src/main.ts`, and `apps/client/src/game/createGame.ts`; configure a Phaser canvas with fixed 1600x900 design resolution, resize scaling, scene registration, pointer input, and no gameplay authority. Depends on DEP-001 and PAT-001. | No | — |
| TASK-002 | Line 1 Worker B creates `docs/art-direction.md`, `apps/client/public/assets/original/terrain/`, `apps/client/public/assets/original/buildings/`, `apps/client/public/assets/original/units/`, and `apps/client/public/assets/original/ui/`; define a 2:1 isometric tile grid, original silhouettes, color palette, sprite dimensions, animation naming, export settings, and HUD spacing that satisfy REQ-008 and CON-005. | No | — |
| TASK-003 | Line 2 Worker A creates `packages/shared/src/protocol/commands.ts`, `packages/shared/src/protocol/state.ts`, `packages/shared/src/isometric/coordinates.ts`, and `packages/shared/src/content/villages.ts`; implement typed schemas, coordinate round trips, three village records, and a five-record limit. Depends on TASK-001. | No | — |
| TASK-004 | Line 2 Worker B creates `packages/shared/src/random/seededRandom.ts`, `packages/shared/src/content/units.ts`, `packages/shared/src/content/buildings.ts`, and `packages/shared/src/content/resources.ts`; define deterministic random generation and all MVP balance constants required by REQ-005. | No | — |
| TASK-005 | Line 3 Worker A creates the root workspace manifest, TypeScript base configuration, formatter configuration, lint configuration, frozen lockfile, and `.github/workflows/ci.yml`; CI must execute type checking, linting, unit tests, integration tests, license validation, secret scanning, dependency audit, and Playwright smoke tests. | No | — |
| TASK-006 | Line 3 Worker B creates `scripts/check-licenses.mjs`, `assets/ATTRIBUTION.md`, `SECURITY.md`, `LICENSE`, and `docs/dependency-policy.md`; enforce the approved MIT, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, CC-BY-4.0, and Apache-2.0 allowlist while requiring attribution records for asset files. | No | — |
| TASK-007 | Each line supervisor validates its two worker deliverables against REQ-001 through REQ-013, SEC-001 through SEC-004, and CON-001 through CON-005, records an explicit approve or reject decision under `audit/reviews/phase-1/`, and sends only approved work to that line's auditor. Depends on TASK-001 through TASK-006. | No | — |
| TASK-008 | Each line auditor independently executes TEST-001, TEST-002, TEST-010, and the relevant static checks; record findings under `audit/reviews/phase-1/`, produce the required compressed summary under `audit/handoffs/phase-1/`, and apply the run-scoped cleanup allowlist only after approval. Depends on TASK-007. | No | — |

### Implementation Phase 2

- **GOAL-002**: Deliver the playable isometric client, original HUD and assets, deterministic economy and combat, and five selectable AI opponents.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Line 1 Worker A implements `BootScene`, `PreloadScene`, `VillageSelectScene`, `MatchScene`, and `ResultsScene` under `apps/client/src/scenes/`; implement camera pan and zoom, drag and click selection, command targeting, placement preview, minimap, selection panel, and command panel using shared protocol types. Depends on TASK-001 and TASK-003. | No | — |
| TASK-010 | Line 1 Worker B creates original production sprite sheets and implements `apps/client/src/ui/Hud.ts`, `ResourceBar.ts`, `SelectionPanel.ts`, `CommandPanel.ts`, `Minimap.ts`, and `AccessibilitySettings.ts`; update `assets/ATTRIBUTION.md` for every shipped file and meet REQ-009. Depends on TASK-002. | No | — |
| TASK-011 | Line 2 Worker A implements `apps/server/src/simulation/createMatchState.ts`, `stepSimulation.ts`, `validateCommand.ts`, `systems/economySystem.ts`, `systems/constructionSystem.ts`, `systems/movementSystem.ts`, `systems/combatSystem.ts`, and `systems/victorySystem.ts`; all changes must be deterministic and authoritative. Depends on TASK-003 and TASK-004. | No | — |
| TASK-012 | Line 2 Worker B implements `apps/server/src/ai/profiles.ts`, `AiController.ts`, `planners/economyPlanner.ts`, `planners/defensePlanner.ts`, and `planners/attackPlanner.ts`; expose `createAiController(profileId, playerId, seed)` and support `aggressor`, `guardian`, `prosperer`, `balanced`, and `raider` selection with the distinct behavior required by AI-003 through AI-007 in the design specification. Depends on TASK-011. | No | — |
| TASK-013 | Line 3 Worker A implements `apps/server/src/local/LocalMatchRunner.ts` and `apps/client/src/network/LocalMatchAdapter.ts` so single-player uses the same command validation and simulation code as online matches; implement pause, restart, match seed display, and three AI difficulty presets that change decision interval without granting hidden resources. Depends on TASK-011 and TASK-012. | No | — |
| TASK-014 | Line 3 Worker B creates deterministic unit tests under `tests/unit/`, simulation integration tests under `tests/integration/`, and browser flows under `tests/e2e/single-player.spec.ts`; include fixed-seed replay equality, coordinate round trips, illegal-command rejection, all AI profile boot tests, victory, keyboard navigation, and asset-license coverage. Depends on TASK-009 through TASK-013. | No | — |
| TASK-015 | Each line supervisor verifies its Phase 2 implementation, reviews captured browser images for originality and layout defects, confirms all acceptance tests relevant to the line pass, and records an approve or reject decision under `audit/reviews/phase-2/`. Depends on TASK-009 through TASK-014. | No | — |
| TASK-016 | Each line auditor reruns tests from a clean install, verifies traceability from requirement to evidence, stores the audit decision under `audit/reviews/phase-2/`, writes a compressed handoff under `audit/handoffs/phase-2/`, and removes only approved run-scoped temporary outputs. Depends on TASK-015. | No | — |

### Implementation Phase 3

- **GOAL-003**: Deliver authoritative Colyseus private rooms, reconnect behavior, multiplayer security, load coverage, and a reproducible release candidate.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-017 | Line 1 Worker A implements `apps/client/src/network/ColyseusMatchAdapter.ts`, `apps/client/src/scenes/MultiplayerLobbyScene.ts`, and room-code routing; expose create room, join room, ready, leave, disconnect status, reconnect countdown, and recoverable error states. Depends on DEP-002 and TASK-009. | No | — |
| TASK-018 | Line 1 Worker B implements original multiplayer lobby, player roster, latency indicator, readiness, reconnect, defeat, victory, and error presentation assets; verify all states at 1280x720, 1600x900, and 1920x1080 and update `assets/ATTRIBUTION.md`. Depends on TASK-010 and TASK-017. | No | — |
| TASK-019 | Line 2 Worker A implements `apps/server/src/rooms/VillageSiegeRoom.ts`, `apps/server/src/rooms/LobbyRoom.ts`, `apps/server/src/auth/roomCode.ts`, and `apps/server/src/index.ts`; support two to four human players plus optional AI-filled slots within the five-faction limit, secure six-character private codes, readiness, server-owned start, server-owned seeds and rule outcomes, ten simulation ticks per second, sixty-second disconnect grace, and authoritative state snapshots. Depends on TASK-011. | No | — |
| TASK-020 | Line 2 Worker B implements per-client token-bucket rate limits, payload-size limits, monotonic command sequence checks, ownership checks, coordinate bounds, resource validation, structured security logging, and abuse tests around `validateCommand`; document the resulting threat mitigations in `docs/threat-model.md`. Depends on TASK-019 and SEC-001 through SEC-003. | No | — |
| TASK-021 | Line 3 Worker A creates `tests/integration/multiplayer-room.test.ts`, `tests/load/four-player-match.ts`, and `tests/e2e/multiplayer.spec.ts`; test room lifecycle, readiness, four clients, illegal intent rejection, disconnect and reconnect, victory synchronization, ten-minute stability, and the budgets in CON-002 and CON-003. Depends on TASK-017 through TASK-020. | No | — |
| TASK-022 | Line 3 Worker B creates `README.md`, `CONTRIBUTING.md`, `docs/running-locally.md`, `docs/multiplayer-operations.md`, `docs/release-checklist.md`, and release packaging scripts; document no-login local hosting, deployment environment variables, source and asset licenses, limitations, and exact reproducible build commands. Depends on TASK-005 and TASK-006. | No | — |
| TASK-023 | Each line supervisor reviews Phase 3 source, security controls, visual evidence, test evidence, and license reports; record a signed approve or reject decision under `audit/reviews/phase-3/` and block release on any unresolved severity-high finding or failed required test. Depends on TASK-017 through TASK-022. | No | — |
| TASK-024 | Each line auditor performs clean-room verification, independently validates the supervisor decision, writes findings under `audit/reviews/phase-3/`, writes a compressed context summary under `audit/handoffs/phase-3/`, and performs only the allowed run-scoped cleanup after approval. Depends on TASK-023. | No | — |

### Implementation Phase 4

- **GOAL-004**: Complete cross-line release governance, preserve required evidence, and produce the approved open-source MVP handoff.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-025 | The three supervisors perform a cross-line integration review using `docs/release-checklist.md`; verify frozen dependencies, asset provenance, deterministic replay, AI selection, three village selections, four-player rooms, reconnect, accessibility, security gates, and absence of protected third-party game expression. Depends on TASK-024. | No | — |
| TASK-026 | The three auditors independently rerun the release commands, compare results with all phase evidence, create `audit/release/final-audit.md`, and reject the release if evidence is missing, a license is incompatible, a required test fails, or cleanup targets exceed the documented allowlist. Depends on TASK-025. | No | — |
| TASK-027 | The release owner consumes only approved compressed handoffs, creates `audit/release/owner-decision.md`, records approval or rejection, and on approval creates a versioned source archive plus checksum without bundling caches, secrets, raw temporary logs, or transient test artifacts. Depends on TASK-026. | No | — |

## 3. Alternatives

- **ALT-001**: Use Godot with a native export. This was not selected because the MVP prioritizes immediate browser delivery, TypeScript collaboration, and WebSocket room hosting with no client installation.
- **ALT-002**: Use peer-to-peer lockstep multiplayer. This was not selected because authoritative server validation provides a clearer anti-cheat boundary, simpler reconnect semantics, and consistent AI ownership.
- **ALT-003**: Generate final production art by copying or tracing a commercial real-time strategy game. This was rejected because it creates intellectual-property and originality risks; the project requires original silhouettes, palette, interface composition, maps, names, and audio.
- **ALT-004**: Ship five fully distinct villages in the first milestone. This was deferred because three data-driven villages validate the architecture while keeping the first playable scope controllable; the schema still reserves capacity for five.

## 4. Dependencies

- **DEP-001**: Phaser provides the browser renderer, scene lifecycle, input, cameras, texture loading, and animation; its exact resolved version must be committed to the frozen workspace lockfile and accepted by the license check.
- **DEP-002**: Colyseus client and server packages provide WebSocket rooms, schema synchronization, matchmaking primitives, and reconnection; exact resolved versions must be committed to the frozen workspace lockfile and use mutually compatible protocol versions.
- **DEP-003**: TypeScript, the workspace package manager, Vite, Vitest, Playwright, ESLint, and the formatter provide build and verification tooling; CI must install them from the frozen lockfile.
- **DEP-004**: A supported Node.js active-LTS runtime is required by the server and build; `.nvmrc` and `package.json` `engines.node` must declare the same exact major and minor baseline before implementation tasks begin.
- **DEP-005**: Production deployment requires one TLS-terminating host capable of persistent WebSocket connections and exposing only the documented runtime configuration values; local development must remain functional without third-party login.

## 5. Files

- **FILE-001**: `apps/client/src/game/createGame.ts` and `apps/client/src/scenes/` contain the Phaser bootstrap and client scene flow.
- **FILE-002**: `apps/client/src/ui/` contains the original HUD, lobby, minimap, accessibility, and command presentation.
- **FILE-003**: `apps/client/public/assets/original/` contains only original production art and audio assets.
- **FILE-004**: `apps/client/src/network/` contains interchangeable local and Colyseus match adapters.
- **FILE-005**: `apps/server/src/simulation/` contains deterministic authoritative economy, movement, construction, combat, victory, and command validation.
- **FILE-006**: `apps/server/src/ai/` contains AI profiles, controllers, and economy, defense, and attack planners.
- **FILE-007**: `apps/server/src/rooms/` and `apps/server/src/auth/roomCode.ts` contain multiplayer room lifecycle and private code logic.
- **FILE-008**: `packages/shared/src/` contains serializable protocol types, isometric transforms, seeded random utilities, and content tables.
- **FILE-009**: `tests/unit/`, `tests/integration/`, `tests/e2e/`, and `tests/load/` contain reproducible automated evidence.
- **FILE-010**: `docs/production-workflow.md`, `audit/reviews/`, `audit/handoffs/`, and `audit/release/` contain gated production and approval evidence.
- **FILE-011**: `assets/ATTRIBUTION.md`, `LICENSE`, `SECURITY.md`, and `docs/dependency-policy.md` contain licensing, provenance, disclosure, and dependency controls.
- **FILE-012**: `.github/workflows/ci.yml`, workspace manifests, runtime configuration, and the frozen lockfile define the reproducible build and quality gates.

## 6. Testing

- **TEST-001**: Unit-test both isometric coordinate functions across origin, negative, boundary, and round-trip cases with exact expected results.
- **TEST-002**: Unit-test seeded random output and replay the same accepted command stream twice; serialized final states and victory tick must be byte-identical.
- **TEST-003**: Integration-test resource gathering, construction prerequisites, population limits, training costs, movement, damage, destruction, and town-center victory.
- **TEST-004**: Unit-test `aggressor`, `guardian`, `prosperer`, `balanced`, and `raider` AI creation, distinct behavior metrics, deterministic decisions, legal commands, and survival for ten thousand simulation ticks without exceptions.
- **TEST-005**: Integration-test all invalid command classes: malformed schema, excessive size, wrong ownership, impossible coordinate, insufficient resource, cooldown, stale sequence, and rate limit.
- **TEST-006**: Browser-test single-player village selection, AI selection, match start, selection, gather, build, train, attack, pause, restart, victory, and results navigation.
- **TEST-007**: Multiplayer-test private room create and join, two-to-four-player readiness, authoritative start, synchronized combat, disconnect grace, reconnect, defeat, and room disposal.
- **TEST-008**: Load-test one ten-minute four-player match at 128 units per player while recording simulation drift, server event-loop delay, memory, state-patch size, and client frame rate against CON-002 and CON-003.
- **TEST-009**: Accessibility-test keyboard navigation, remappable controls, visible focus, icon text alternatives, non-color status communication, reduced motion, and independent music and effects volumes.
- **TEST-010**: License-test every dependency and shipped asset against the allowlist, fail on missing attribution or unknown terms, and scan source plus build output for committed secrets.
- **TEST-011**: Visual-regression-test the village selector, all three village maps, HUD states, multiplayer lobby, reconnect state, and results state at the three supported viewport sizes.
- **TEST-012**: Clean-install release-test build, server start, client start, one AI match, one two-client online match, archive contents, and checksum generation using only documented commands.

## 7. Risks & Assumptions

- **RISK-001**: Deterministic simulation can diverge if floating-point operations, iteration order, or wall-clock time leak into rules; seeded integers, stable sorting, fixed ticks, and replay equality tests mitigate this risk.
- **RISK-002**: Pathfinding for 512 active units can exceed the server tick budget; capped search work, flow-field reuse, command queues, profiling, and the stated unit cap mitigate this risk.
- **RISK-003**: A visual direction described as similar in era or readability to a commercial title can drift into protected expression; originality review, asset provenance, unique layouts, and rejection of traced material mitigate this risk.
- **RISK-004**: Reconnect and late message ordering can corrupt match state; monotonic sequences, server ownership, snapshot recovery, and lifecycle integration tests mitigate this risk.
- **RISK-005**: Cleanup automation can remove evidence or user work; cleanup is post-audit, run-scoped, allowlisted, path-validated, and prohibited from touching source, assets, lockfiles, approvals, or retained evidence.
- **ASSUMPTION-001**: The first release targets desktop web browsers and uses a single regional game-server process; horizontal scaling and mobile controls are post-MVP work.
- **ASSUMPTION-002**: All final art and audio are created by project contributors or imported under an approved license with complete attribution before supervisor review.
- **ASSUMPTION-003**: Online multiplayer uses private room codes without accounts, public matchmaking, chat, rankings, purchases, or persistent player profiles in the MVP.
- **ASSUMPTION-004**: Three village definitions and five AI profiles are required for the first playable release while village schemas preserve the explicit five-village capacity.

## 8. Related Specifications / Further Reading

- [Production workflow](../docs/production-workflow.md)
- [Phaser documentation](https://docs.phaser.io/)
- [Colyseus documentation](https://docs.colyseus.io/)
- [Open Source Initiative MIT License text](https://opensource.org/license/mit)
- [W3C Web Content Accessibility Guidelines](https://www.w3.org/TR/WCAG22/)
