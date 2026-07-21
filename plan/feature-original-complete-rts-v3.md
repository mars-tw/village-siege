---
goal: Original Complete RTS and Fully Open-Source Multiplayer
version: 3.0
date_created: 2026-07-20
last_updated: 2026-07-21
owner: Village Siege production team
status: 'In progress'
tags: [feature, game, rts, multiplayer, self-hosting, originality]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

This plan turns Village Siege into a genre-complete, original settlement RTS with economy, eras, research, fog of war, fortifications, strategic AI, deterministic replay and server-authoritative multiplayer. It reproduces familiar RTS system categories without copying Age of Empires artwork, audio, names, maps, interface, story, source code or proprietary balance values. “Private design” means an original Village Siege identity, while the complete project remains MIT licensed, openly auditable and self-hostable. Only live credentials stay outside version control.

## 1. Requirements & Constraints

- **REQ-001**: A complete match shall support scout, gather, deposit, construct, advance era, research, train, command, breach, conquer and restart flows without reloading the page.
- **REQ-002**: The economy shall include food, wood and stone with finite world nodes, carrying capacity, drop-off rules, farms, worker reassignment and visible resource feedback.
- **REQ-003**: Players shall progress through three original eras named Frontier, Stronghold and Artificer; era requirements and research effects shall be deterministic and data-driven.
- **REQ-004**: Technology research shall change economy, unit, building or siege statistics and shall enforce producer, era, cost, queue and duplicate-research rules.
- **REQ-005**: Combat shall support move, attack, attack-move, patrol, stop, repair, rally point, stance, formation, active ability and queue cancellation commands.
- **REQ-006**: Maps shall support explored and visible fog states, neutral threats, continuous terrain, walls, gates, towers, chokepoints and destructible navigation changes.
- **REQ-007**: Three to five original villages and five AI personalities shall have measurable build-order, economy, research, composition and attack-timing differences.
- **REQ-008**: Victory conditions shall include command-center conquest, elimination and configurable landmark or timed-control objectives with explicit defeat and surrender states.
- **REQ-009**: Owner-private save files, tick command journals and deterministic replays shall each declare schema, protocol and rules versions, require an exact supported three-layer tuple and reject incompatible data atomically. They contain full authority and shall not be exposed as recipient-filtered public snapshots.
- **REQ-010**: Multiplayer move, economy, build, train, research, combat, fog, victory and reconnect state shall be server-authoritative before the public UI calls it multiplayer combat.
- **REQ-011**: Desktop and 667x375 or 844x390 landscape phone users shall be able to complete every required operation through a fixed viewport with targets at least 44 CSS pixels.
- **REQ-012**: Runtime visuals, unit names, factions, balance values, maps, sounds and interface composition shall remain original Village Siege intellectual property.
- **SEC-001**: The server shall validate ownership, visibility, costs, population, era, research, cooldown, range, placement, reachability, sequence and rate limits for every command.
- **SEC-002**: Hidden fog-of-war entities shall never be serialized to unauthorized clients; passwords, tokens and private keys shall not enter the public repository.
- **CON-001**: Do not copy or trace Age of Empires assets, audio, text, heraldry, maps, UI frames, source code, campaigns or numeric data tables.
- **CON-002**: GitHub Pages may host only the static client; authoritative multiplayer requires a separately deployed WSS server.
- **GUD-001**: Every feature shall land with deterministic shared tests before client presentation or AI integration.
- **GUD-002**: Public product copy shall describe the game as an original classic RTS and shall not imply Microsoft or Age of Empires affiliation.
- **PAT-001**: `packages/shared` is the single rules authority; client scenes render state and submit intents, while server rooms own online simulation.

## 2. Implementation Steps

### Implementation Phase 1 - Baseline and architecture

- GOAL-001: Establish the complete feature matrix, legal originality boundary and executable architecture.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Audit v2 against `spec/spec-design-classic-rts-village-assault-quality-gates.md`, record Codex and Grok gaps, and create this v3 plan. | Yes | 2026-07-20 |
| TASK-002 | Add `docs/architecture/authoritative-rts-v3.md` defining protocol versions, fixed ticks, snapshots, deltas, hashes, reconnect leases and client rendering boundaries. | Yes | 2026-07-20 |
| TASK-003 | Add a public originality statement and a fully open-source deployment boundary to README and architecture documentation. | Yes | 2026-07-20 |

### Implementation Phase 2 - Complete economy, eras and technology

- GOAL-002: Deliver deterministic progression from a starting settlement to a late-game economy and army.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Add the original Frontier, Stronghold and Artificer settlement tiers plus data-driven building and unit unlock contracts to `packages/shared`. | Yes | 2026-07-20 |
| TASK-005 | Implement deterministic settlement-advance prerequisites, costs, timing, cancellation and completion events in `packages/shared/src/simulation.ts`. | Yes | 2026-07-20 |
| TASK-006 | Replace instant gathering with deterministic carry and drop-off flow, renewable farms and resource exhaustion in `packages/shared/src/simulation.ts`. | Yes | 2026-07-20 |
| TASK-007 | Expose settlement tier, requirements, progress and locked content in `VillageAssaultScene.ts` without exceeding the seven-slot mobile dock. | Yes | 2026-07-20 |
| TASK-008 | Teach all five AI profiles legal prerequisite building and distinct deterministic settlement-advance timing in `packages/shared/src/ai.ts`. | Yes | 2026-07-20 |
| TASK-027 | Add data-driven technology research contracts, queues, duplicate checks, effects, AI priorities and fixed-dock presentation. | Yes | 2026-07-20 |
| TASK-028 | Add rally points, production queue cancellation and their deterministic shared/client contracts. | Yes | 2026-07-20 |

### Implementation Phase 3 - Tactical combat, fog and fortified villages

- GOAL-003: Make scouting, positioning, counters and breaching a complete tactical loop.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Implement attack-move, repair, stance, formation, active abilities, per-role passives and deterministic locked, area and line-projectile commands in shared simulation and client input. | Yes | 2026-07-20 |
| TASK-010 | Implement explored/visible fog grids, stale sightings and per-player filtered public snapshots in `packages/shared/src/visibility.ts`. | Yes | 2026-07-20 |
| TASK-011 | Add wall, gate, landmark and rubble entities with open, closed, damaged and destroyed pathing transitions. | Yes | 2026-07-20 |
| TASK-012 | Add original continuous terrain, fortified village layouts, neutral monsters, civilian activity and breach effects for three to five map starts. | Yes | 2026-07-21 |
| TASK-013 | Complete six-facing idle, walk, attack, hurt, death and cast runtime animation coverage and retain asset/license verification evidence. |  |  |

### Implementation Phase 4 - Strategic AI, victory, save and replay

- GOAL-004: Provide replayable single-player matches with distinct opponents and recoverable state.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Add strategic AI scouting memory, counter-composition, wall defense, repair, retreat, regroup and multi-wave assault planners. | Yes | 2026-07-21 |
| TASK-015 | Add conquest, elimination, landmark and timed-control victory policies with deterministic scoring and result events. | Yes | 2026-07-21 |
| TASK-016 | Add owner-private versioned save snapshots, tick command journals, replay import/export, exact schema/protocol/rules compatibility rejection and a 10,000-tick deterministic hash gate. | Yes | 2026-07-21 |
| TASK-017 | Add an interactive touch-completable tutorial covering economy, era, research, fog, combat, breach and victory. | Yes | 2026-07-21 |

### Implementation Phase 5 - Server-authoritative multiplayer

- GOAL-005: Move the full match truth to Colyseus and prove synchronized online play.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | Split lobby and authoritative match rooms; run fixed shared simulation ticks and accept only validated command intents in `apps/server`. | Yes | 2026-07-21 |
| TASK-019 | Add protocol and rules negotiation, command IDs, deduplication, filtered deltas, five-second snapshots and two-second canonical hashes. | Yes | 2026-07-21 |
| TASK-020 | Add 120-second reconnect leases, snapshot recovery, command journal replay and explicit server-failure outcomes. | Yes | 2026-07-21 |
| TASK-021 | Convert `VillageAssaultScene.ts` online mode to interpolate server state without locally committing resources, damage, training or victory. | Yes | 2026-07-21 |
| TASK-022 | Add two-client and five-faction-including-AI deterministic post-receive delay/loss/reordering, malicious command, fog leak, real reconnect and final-hash tests. | Yes | 2026-07-21 |

### Implementation Phase 6 - Open deployment, open-source release and quality gate

- GOAL-006: Ship a self-hostable MIT release with secret-free public templates, operator-supplied credentials and retained evidence.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-023 | Add public Dockerfiles, `.env.example`, local Compose, SBOM, dependency scan and self-hosting guide without production secrets. | Yes | 2026-07-21 |
| TASK-024 | Publish sanitized infrastructure templates for TLS, WSS, Redis, PostgreSQL, backups and monitoring while keeping live credentials outside Git. | Yes | 2026-07-21 |
| TASK-025 | Pass deterministic, AI, multiplayer, Playwright mobile/desktop, performance, asset, secret and license quality gates with Codex plus Grok audit. | Yes | 2026-07-21 |
| TASK-026 | Merge the complete release, deploy the public client and a publicly reachable self-hosted authoritative server, then verify a real two-client match from the public URL. |  |  |

## 3. Alternatives

- **ALT-001**: Copy an existing commercial RTS ruleset exactly. Rejected because it creates intellectual-property and product-identity risk and would not improve the current deterministic architecture.
- **ALT-002**: Keep multiplayer peer-to-peer in a player browser. Rejected because host migration, fog secrecy, cheating, NAT and deterministic recovery become materially harder.
- **ALT-003**: Make the repository or infrastructure code private. Rejected because the requested ownership boundary is original design, not closed source; all reusable code and templates remain MIT open source.

## 4. Dependencies

- **DEP-001**: Phaser client renderer and input system.
- **DEP-002**: Shared deterministic TypeScript simulation and Vitest suite.
- **DEP-003**: Colyseus authoritative room server.
- **DEP-004**: Playwright desktop and landscape-phone browser automation.
- **DEP-005**: Redis and PostgreSQL for production reconnect leases, snapshots and command journals.
- **DEP-006**: Docker or compatible OCI runtime, TLS reverse proxy and operator-controlled deployment host.

## 5. Files

- **FILE-001**: `packages/shared/src/protocol.ts` - versioned commands, events and public contracts.
- **FILE-002**: `packages/shared/src/content.ts` - original eras, technologies, units, buildings and costs.
- **FILE-003**: `packages/shared/src/simulation.ts` - deterministic economy, research, combat and victory authority.
- **FILE-004**: `packages/shared/src/ai.ts` - five strategic AI planners and telemetry.
- **FILE-005**: `packages/shared/src/visibility.ts` - fog grids and filtered player views.
- **FILE-006**: `apps/client/src/scenes/VillageAssaultScene.ts` - fixed-viewport controls and authoritative-state presentation.
- **FILE-007**: `apps/server/src/rooms/VillageSiegeRoom.ts` - lobby compatibility during migration.
- **FILE-008**: `apps/server/src/rooms/AuthoritativeMatchRoom.ts` - full server-owned online match.
- **FILE-009**: `docs/architecture/authoritative-rts-v3.md` - synchronization and self-host architecture.
- **FILE-010**: `README.md` and deployment guides - originality, fully open-source and self-hosting contract.

## 6. Testing

- **TEST-001**: Fixed-seed economy, era, technology, combat and victory tests remain deterministic; replaying 10,000 fixed ticks twice from the same version-compatible snapshot and journal produces identical checkpoint and final canonical state hashes.
- **TEST-002**: Every invalid ownership, cost, population, era, duplicate research, visibility, range, placement and sequence command is rejected without mutation.
- **TEST-003**: Five AI profiles finish 30-minute simulated matches with distinct telemetry and zero rejected self-issued commands.
- **TEST-004**: Fog serialization tests prove hidden enemy entities and orders never reach an unauthorized client.
- **TEST-005**: Two browsers complete an authoritative match including build, train, research, combat, disconnect, reconnect and victory with the same final hash.
- **TEST-006**: Five factions including server-owned AI remain stable while the post-receive delivery harness applies 50, 100 and 200 ms delay, exact two-percent delta loss and reordering without duplicate costs; a real socket drop/reconnect also converges. Proxy/netem transport shaping belongs to the public deployment gate.
- **TEST-007**: Desktop 1280x720 and mobile 667x375 plus 844x390 touch-only flows have no overlap, scrolling, clipped controls or targets under 44 CSS pixels.
- **TEST-008**: Public deployment artifacts pass secret, dependency, license, asset, SBOM and live HTTP/WSS checks.

## 7. Risks & Assumptions

- **RISK-001**: “Complete Age of Empires mirror” can be interpreted as copying protected expression; this plan limits parity to genre mechanics and requires original presentation and balance.
- **RISK-002**: A complete RTS is a multi-release effort; premature publication claims could misrepresent lobby, fog, AI or combat completeness.
- **RISK-003**: Full authoritative snapshots may exceed browser bandwidth; filtered deltas, periodic full snapshots and canonical hashes must be profiled before production.
- **RISK-004**: Mobile seven-slot controls can become inaccessible as commands grow; contextual paging and automated geometry tests are mandatory.
- **RISK-005**: Authoritative save and replay files include hidden fog state and private AI plans; they must not be exposed as public player snapshots. FNV hashes diagnose accidental corruption or desync only and do not authenticate hostile files.
- **ASSUMPTION-001**: “Private design” means original Village Siege branding, gameplay, art and worldbuilding while the entire reusable project remains MIT open source.
- **ASSUMPTION-002**: Three original eras and three to five villages satisfy the intended classic-RTS progression without copying a commercial title's exact era system.

## 8. Related Specifications / Further Reading

- `spec/spec-design-classic-rts-village-assault-quality-gates.md`
- `spec/spec-design-village-siege.md`
- `plan/feature-rts-production-spatial-v2.md`
- `docs/audits/v2-grok-audit.md`
