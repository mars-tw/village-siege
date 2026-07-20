# Village Siege v0.10 world-systems audit

Date: 2026-07-21

Branch: `codex/rts-complete-v3`

Scope: v3 `TASK-012` — original continuous terrain, fortified village starts,
civilian activity, authoritative neutral threats, breach presentation and
landscape-phone integration.

Final verdict: **APPROVE WITH P2** — P0 = 0 and P1 = 0.

## Independent Grok CLI review

- CLI: `grok 0.2.106 (bde89716f6)`
- Model: `grok-4.5`
- Permission boundary: `plan` (read-only), web disabled, memory disabled,
  subagents disabled
- Session: `019f80a0-3857-7ed1-8675-a30a3a17c1e4`

The first pass returned `CHANGES_REQUIRED`. It identified two P1 blockers:
hidden `monsterProvoked` source/team leakage and rewards that declared temporary
buffs without applying them. It also identified P2 gaps in authoritative monster
skills, layout fallback validation, tests and worktree hygiene.

After remediation, Grok re-read the current diff and returned `APPROVE` with no
P0 or P1. The re-audit explicitly confirmed:

1. fatal same-tick monster provocation remains visible while a hidden source ID
   and team are masked;
2. three timed team boons are stored, applied, exposed only to their recipient
   and expired by authoritative tick;
3. Miremaw, Ashwing and Rootback skills, target priorities and passives execute
   in the shared simulation;
4. every three-to-five-player compatibility spawn is deterministic and legal on
   Pinehold, Riverstead and Highcrag;
5. delayed projectiles and burn retain player attribution after their source is
   removed;
6. mobile pointer boundaries, enlarged hit zones, death retirement, dynamic
   texture cleanup and exact selected-layout terrain are present.

## Verification

- `npm run typecheck`: passed for client, server and shared at version 0.10.0.
- `npm test`: **7 files / 161 tests passed**.
- `npm run build`: passed for client and server.
  - Client JavaScript: 1,825.89 kB minified / 493.27 kB gzip.
  - Vite's chunk-size warning is non-blocking P2 performance debt.
- `npm run smoke:multiplayer:local`: passed with a two-player room, host-only
  start, readiness gate, invalid-payload rejection, reconnect and authoritative
  tick progression.
- System Chrome browser QA at 1280×720 and 568×320: page and canvas fit the
  viewport, the fixed seven-slot dock remains operable, selecting all workers
  exposes build/drop-off/repair/stop actions, and the console reports zero
  errors and zero warnings.

## Remediated findings

### Authority and fog

- `monsterProvoked` consults a same-frame removal record before dropping the
  event and masks both source and team when the attacker is hidden.
- Reward events route only to the receiving player; contribution details and
  raw provoking-team state are absent from public monster state.
- Projectile and status records carry a stable source owner separately from the
  source entity, so post-removal impacts and damage-over-time remain attributable.

### World rules

- All three layouts have unique terrain and reserved-build topology, two legal
  authored start slots and three distinct camps.
- The compatibility bootstrap independently searches for legal town-center,
  civilian and resource cells instead of clamping onto water, rock or reserved
  routes.
- Layout validation rejects duplicate start slots, repeated constraint
  topology, illegal footprints and overlapping activity anchors.

### Neutral threats and rewards

- Miremaw opens with a camouflage speed burst and applies a slowing ambush.
- Ashwing prioritizes ranged or wounded rear-line targets and performs a
  staggering dive.
- Rootback prioritizes buildings, performs an area slam and gains damage plus
  cadence below forty-percent health.
- Credited teams receive deterministic resource shares plus one of three
  tick-expiring gather, speed or attack boons; the HUD displays the current
  boon and remaining seconds.

### Client and mobile

- Workers render distinct field, harvest, carry, construction and repair poses.
- Visible monsters use their authored directional sheets for idle, movement,
  attack/cast, hurt and death presentation.
- Removed actors finish death playback before disposal; direct touch hit areas
  are enlarged and pointer input outside the world viewport cannot click through
  the HUD.
- Terrain rendering consumes the selected authoritative glyph grid instead of a
  Pinehold-only visual table.

## Delegated cross-audits

Three independent read-only reviewers issued final `APPROVE` verdicts with
P0 = 0, P1 = 0 and P2 = 0:

- combat and fog regression audit;
- landscape-phone static UI and asset-lifecycle audit;
- projectile, world-layout and compatibility-bootstrap audit.

Their interim findings were remediated before the final verification run:
death playback now completes before fading, the active-boon HUD is exactly two
explicit non-wrapping lines, all battle-scoped textures are released on scene
shutdown, and overlapping custom spawn overrides cannot place a later command
center over an earlier civilian. The last case is covered across all three
layouts with five identical override points.

## Remaining P2

1. The main client chunk is still large and should be split in a later
   performance task.
2. Full release publication is not authorized by this task. Strategic wall-aware
   AI, complete victory/save/replay work and full authoritative battlefield
   multiplayer remain later v3 gates.

One-time browser screenshots and Playwright metadata were moved out of the
worktree into the recoverable Windows temporary folder before commit; the new
worker actor source is included in the intended change set.

## Decision

`TASK-012` meets its local quality gate. The implementation may be committed and
the project may proceed to `TASK-014`; this decision does not declare the whole
v3 roadmap or public multiplayer release complete.
