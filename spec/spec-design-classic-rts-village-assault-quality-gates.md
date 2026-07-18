---
title: Village Siege Classic RTS Village Assault Quality Gates
version: 1.0.0
date_created: 2026-07-18
last_updated: 2026-07-18
owner: Village Siege production team
tags: [design, rts, village-assault, mobile-landscape, art, animation, qa]
---

# Introduction

This specification defines the release bar for turning Village Siege from a combat showcase into an original, high-quality village-assault RTS. “Classic RTS” means the genre's functional pillars—economy, construction, scouting, formations, counters, base assault and strategic AI—not copied Age of Empires II assets, UI, sounds, names, layouts or trade dress.

## 1. Purpose & Scope

The accepted product shall support a complete 10–15 minute match on desktop and a landscape phone. A player selects one of three to five villages, develops a small economy, scouts, trains a mixed army, breaks an enemy settlement's defenses and wins by destroying or capturing its command structure. Every operation required to finish the match must be available through touch in a fixed viewport.

In scope:

- Three to five distinct playable villages and five behaviorally distinct AI profiles.
- Resource gathering, population, building, training, scouting and upgrades.
- Attackable village walls, gates, towers, production buildings and command center.
- Seven existing combat roles, neutral monsters, formations, counters and active abilities.
- Original isometric environment, character, structure, projectile and effects art.
- Desktop mouse/keyboard and phone landscape touch controls.
- Single-player end-to-end completion and the authoritative foundations for multiplayer.

Out of scope for this milestone:

- Copying or recreating a specific commercial game's artwork or interface.
- Ranked matchmaking, spectators, campaigns, naval combat or more than four online players.
- Calling a lobby or synchronized timer “multiplayer combat” before commands, simulation, victory and reconnection are server-authoritative.

## 2. Definitions

- **Fixed viewport**: the page has no document scroll and all required controls remain inside the current viewport.
- **Core operation**: selection, move, attack, camera movement, ability, formation, build, train, gather, repair, group store/recall, pause/restart and exit.
- **Independent facing**: a direction with authored asymmetry and correct equipment placement; a mirrored frame does not count.
- **Village assault loop**: scout → gather → build/train → approach → breach defenses → destroy/capture the command structure → result.
- **AI personality**: a profile that changes priorities and observable decisions, not only a label or status message.
- **Release blocker**: any failed MUST requirement, inaccessible core operation, asset load error, overlap, crash or unwinnable match.

## 3. Requirements, Constraints & Guidelines

### 3.1 Core RTS loop

- **CORE-001**: A match shall expose food, wood and stone; at least one resource must be gathered by villagers from world nodes and deposited or credited through deterministic rules.
- **CORE-002**: Players shall construct a command center, house, military production building and one defensive structure using placement validation and visible cost feedback.
- **CORE-003**: Population capacity shall block training when full and increase through an explicit building or upgrade.
- **CORE-004**: At least three military units shall be trainable during a normal match; the seven-role roster remains the target roster.
- **CORE-005**: The player shall issue select, multi-select, move, attack, attack-move, stop, gather, build, repair and ability commands.
- **CORE-006**: Terrain and structures shall affect pathfinding. Units may not pass through closed walls, occupied building footprints or unwalkable water.
- **CORE-007**: Fog of war shall hide unexplored terrain and stale enemy information; scouting must materially change decisions.
- **CORE-008**: A match shall have a clear start state, objective, victory, defeat and restart path without page reload.

### 3.2 Village assault

- **VIL-001**: The enemy village shall contain a readable perimeter, at least one gate, two defensive positions, civilian/economic activity, production structures and one command objective.
- **VIL-002**: Walls, gates, towers and the command objective shall be targetable, have health and armor classes, show at least healthy/damaged/critical/destroyed visual states and alter navigation when destroyed.
- **VIL-003**: Defenders shall raise an alarm, reposition, repair or reinforce in response to scouting, damage and a breached perimeter.
- **VIL-004**: Destroying peripheral structures alone shall not win. Victory requires the declared command objective, capture threshold or elimination condition.
- **VIL-005**: A successful assault shall produce visible breach, impact, fire/smoke, rubble and result feedback without obscuring target readability.
- **VIL-006**: Each selectable village shall change at least two gameplay parameters and one layout constraint; text-only variants do not pass.

### 3.3 AI opponents

- **AI-001**: Aggressor prioritizes early military production and timing attacks.
- **AI-002**: Guardian prioritizes walls, towers, repair and counterattacks.
- **AI-003**: Prosperer prioritizes villagers, resource growth and a later technology spike.
- **AI-004**: Balanced adapts spending and army composition to scouted threats.
- **AI-005**: Raider targets exposed workers, resources and weak approaches, then disengages.
- **AI-006**: Automated telemetry shall prove each profile changed build order, spending, target selection or attack timing in at least three fixed-seed matches.

### 3.4 Combat, control and animation

- **COM-001**: Unit counters shall remain bounded, readable and survivable; every role has at least two favorable and two unfavorable matchups.
- **COM-002**: Formation destinations shall avoid duplicate slots and recompute around blocked terrain.
- **COM-003**: Damage commits on a declared animation frame or projectile impact; the visual may not hit before or materially after the rule commit.
- **ANI-001**: Shipping units and monsters shall provide six independent facings for `idle`, `walk`, `attack`, `hurt`, `death` and `cast` where applicable.
- **ANI-002**: Walk cycles require at least six readable frames; attacks require anticipation, commit and recovery; death must terminate without returning to idle.
- **ANI-003**: Arrow, bolt, magic and musket effects shall have distinct launch/flight/impact timing and direction.
- **ANI-004**: Animation pivots remain stable within two source pixels; feet may not visibly slide during idle or stationary attacks.

### 3.5 Original visual quality

- **ART-001**: The art direction is an original frontier village under siege: practical timber, rough stone, worn linen, leather, blackened iron, sparse copper and restrained faction cloth.
- **ART-002**: World assets use a consistent 2:1 isometric projection, shared light direction, material scale, footprint convention and occlusion ordering.
- **ART-003**: Roads, fields, waterways and village boundaries must read as continuous terrain; a visible square-board presentation is not acceptable.
- **ART-004**: Every unit is identifiable at gameplay scale by silhouette, weapon and motion—not color alone.
- **ART-005**: Generated key art is a visual target only. It becomes runtime art only after originality, alpha, pivot, direction, frame, scale and in-game QA.
- **ART-006**: No Age of Empires II art, names, heraldry, UI frames, sounds, palettes, map layouts or sprite poses may be copied.

### 3.6 Mobile landscape and responsive interaction

- **MOB-001**: Required phone test viewports are 667×375 and 844×390 CSS pixels in landscape.
- **MOB-002**: At both sizes, `scrollWidth == innerWidth` and `scrollHeight == innerHeight`; all required controls are fully visible.
- **MOB-003**: Interactive targets shall be at least 44×44 CSS pixels and respect safe-area insets.
- **MOB-004**: Distinct buttons, menus, status panels and modal windows shall have zero positive-area overlap.
- **MOB-005**: Touch shall expose every core operation needed to finish a match. No operation may require a keyboard, right mouse button or hover.
- **MOB-006**: Tap friendly selects; drag box-selects; tap ground commands movement; tap enemy commands attack. Camera controls must remain available without canceling selection.
- **MOB-007**: Orientation changes shall recompute layout without reload, clipping or stale hit regions.
- **MOB-008**: The minimum readable gameplay text is 11 CSS pixels for status copy and 12 CSS pixels for primary control labels, except compact nonessential metadata.

### 3.7 Performance and reliability

- **PERF-001**: Asset requests return 2xx and the console has zero project errors.
- **PERF-002**: Desktop 1280×720 frame interval p95 shall be ≤18.5 ms and p99 ≤33.3 ms during a representative battle.
- **PERF-003**: Landscape phone target frame interval p95 shall be ≤25 ms and p99 ≤40 ms with no single input-linked stall above 100 ms.
- **PERF-004**: The representative test shall include at least 40 active units, projectiles, destruction effects and one active village defense.
- **PERF-005**: Initial interactive load on a warm mid-range phone shall be ≤4 seconds on simulated Fast 4G; a progress/error state is required.

### 3.8 Multiplayer truthfulness

- **NET-001**: Public copy shall call the feature a lobby until move, attack, build, train, economy, damage, victory and reconnect state are authoritative and synchronized.
- **NET-002**: The server shall validate commands, ownership, costs, cooldowns, ranges and tick order.
- **NET-003**: A two-client automated match shall prove join, ready, start, commands, disconnect/reconnect and identical final outcome.

## 4. Interfaces & Data Contracts

```ts
type MobileCommand =
  | "selectAll" | "clearSelection" | "move" | "attack" | "attackMove"
  | "castAbility" | "toggleFormation" | "storeGroup" | "recallGroup"
  | "cameraPan" | "build" | "train" | "gather" | "repair"
  | "restart" | "leave";

interface ResponsiveQualitySnapshot {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; scrollHeight: number };
  controls: Array<{
    id: string;
    x: number; y: number; width: number; height: number;
    fullyVisible: boolean;
  }>;
  overlaps: Array<[string, string]>;
}

interface VillageAssaultTelemetry {
  seed: string;
  aiProfile: string;
  resourcesGathered: Record<string, number>;
  buildOrder: readonly string[];
  trainedUnits: readonly string[];
  firstAttackMs?: number;
  breachedStructureIds: readonly string[];
  winner?: "player" | "ai";
}
```

## 5. Acceptance Criteria

- **AC-001**: A new player completes the tutorial and wins a full single-player village assault without external instructions.
- **AC-002**: The village has working economy, construction, training, defenses, destruction and a command-objective victory condition.
- **AC-003**: Five AI profiles produce measurably different decisions under fixed seeds.
- **AC-004**: All seven roles remain visually and mechanically distinguishable in a mixed fight.
- **AC-005**: 667×375 and 844×390 automated geometry reports show all required controls fully visible, all targets ≥44×44 and zero overlap pairs.
- **AC-006**: A touch-only Playwright path selects, multi-selects, moves, attacks, casts, changes formation, stores/recalls groups, pans camera, builds, trains, gathers, repairs, restarts and exits.
- **AC-007**: Browser console errors are zero; typecheck, unit tests and production build pass.
- **AC-008**: Performance gates in PERF-002 through PERF-004 pass on named reference devices.
- **AC-009**: Art review approves projection, lighting, materials, silhouette, independent facings and action timing; placeholder or mirrored directions are rejected.
- **AC-010**: Multiplayer is advertised as playable only after NET-001 through NET-003 pass.

## 6. Test Automation Strategy

- Vitest: economy, costs, population, counters, damage, AI decisions, pathfinding and victory rules.
- Deterministic simulation: fixed seeds, replay hashes and five-profile behavioral telemetry.
- Phaser integration: building footprints, gate state, destruction navigation, attack commits and animation completion.
- Playwright desktop: 1280×720 full match, console, assets and frame timing.
- Playwright mobile: 667×375 and 844×390 geometry, overlap, 44 px targets, orientation change and touch-only completion.
- Multiplayer: two browser clients plus authoritative server, disconnect/reconnect and matching final hashes.
- Visual QA: approved screenshot matrix for village overview, breach, mixed combat, damaged structures, victory and both phone sizes.

## 7. Rationale & Context

The current public build proves differentiated animated units, squad controls, counters, objectives and a lobby, but its playable scene is an arena with beacons rather than an attackable village. This specification separates already-valid combat work from the missing economy, village, AI, art and authoritative multiplayer layers. It also makes mobile landscape a measurable release contract instead of a visual preference.

## 8. Dependencies & External Integrations

- Phaser 4 rendering and input.
- Shared deterministic TypeScript rules.
- Colyseus authoritative server for multiplayer.
- Vite production client.
- Vitest and Playwright validation.
- Project-owned art bible, atlases, manifests and license/attribution records.

## 9. Examples & Edge Cases

- A phone safe-area inset may reduce width, but no control may leave the viewport or shrink below 44×44.
- If a selected unit dies, selection and control groups reconcile without stale commands.
- If a gate collapses while units path toward it, routes recompute and do not cross living wall footprints.
- If an AI cannot afford its preferred build, it chooses a legal fallback rather than idling indefinitely.
- If the player taps beneath a UI control, the UI consumes the event and the map receives no command.
- If an orientation changes to portrait, the game may show an orientation prompt; it may not present a clipped playable layout.

## 10. Validation Criteria

Release status is `GO` only when every MUST requirement and AC-001 through AC-010 pass with retained evidence. A polished screenshot, lobby, animated combat arena or keyboard-only demo is not a substitute for the end-to-end village assault loop.

## 11. Related Specifications / Further Reading

- `spec/spec-design-combat-art-rework.md`
- `spec/spec-design-village-siege.md`
- `docs/rework/art-bible-draft.md`
- `docs/production-workflow.md`
- `audit/rts-quality-gate-audit-2026-07-18.md`
