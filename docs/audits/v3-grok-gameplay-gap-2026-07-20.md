# Village Siege v3 Grok gameplay-gap audit

Date: 2026-07-20

Mode: read-only local source review; web, memory and subagents disabled.

## Execution

- CLI: `C:\Users\digimkt\.grok\bin\grok.exe`
- Version: `grok 0.2.101 (5bc4b5dfad) [stable]`
- Requested model: `grok-4.5`; actual model usage: `grok-4.5-build`
- Reasoning: high
- Permission mode: plan
- Session: `019f7d22-19f4-7643-9530-316d809934d9`
- Request: `8a44a2a9-df5b-435b-b1db-a1e9eeb6bbed`
- Result: successful `EndTurn` after 10 turns

The CLI warned that the requested model was outside its preferred list and that the optional Codex MCP initialization timed out after 65 seconds. The local repository review itself completed successfully.

## Verdict

v2 is a playable single-player village-assault prototype, not yet a genre-complete era-progression RTS.

| Area | Finding | Priority |
| --- | --- | --- |
| Settlement progression | No era or settlement-tier advancement | P0 |
| Technology | No research tree or completed-upgrade effects | P0 |
| Fog | Line-of-sight helper exists, but no explored grid, stale sightings or client-filtered world | P0 |
| Combat | Main simulation uses direct damage and does not integrate the existing counter, armor and projectile model | P0 |
| Fortification | No destructible wall or gate path transition | P0 |
| Multiplayer | Server increments a timer and acknowledges commands but does not own the RTS simulation | P0 if advertised as multiplayer combat |
| Economy | Gathering is credited directly; no carrying or drop-off logistics | P1 |
| Repair | No worker repair command or resource expenditure | P1 |
| AI memory | `rememberedEnemySites` is not connected to a runtime scouting-memory loop | P1 |
| Save/replay | Hash helpers exist, but there is no versioned save or playable command journal | P1 |
| Tactical depth | Garrison, stance, formation, attack-move and active ability are incomplete in the main loop | P2 |

## Accepted v3 sequence

Codex and Grok independently prioritized original settlement progression as the first vertical slice. The implementation uses three Village Siege tiers—Frontier, Stronghold and Artificer—plus data-driven unlocks, deterministic upgrade work, five-profile AI progression and fixed-viewport controls. It deliberately does not reuse another game's era names, assets or balance.

Subsequent release blockers remain fog filtering, technology effects, destructible walls/gates, authoritative armor/counters and true server-owned multiplayer. The public UI must continue to label the current online feature as a prototype until those multiplayer gates pass.

## Settlement-tier slice final review

After implementation, Grok CLI performed a second read-only review of the uncommitted v3 slice.

- CLI/version: `C:\Users\digimkt\.grok\bin\grok.exe`, `grok 0.2.101 (5bc4b5dfad) [stable]`
- Actual model: `grok-4.5-build`
- Session: `019f7d59-107d-7542-8b30-99824a8b9340`
- Final request: `a829683e-e8ae-4909-87e4-51c17381c500`
- Result: exit `0`, `EndTurn`
- Verdict: **PASS WITH P2**; P0 `0`, P1 `0`

The review accepted the deterministic tier costs, prerequisites, 450/600-tick completion, destruction cancellation, unlock gates, five-profile AI integration, fixed seven-slot client dock and explicit first-slice/open-source wording. It also confirmed that this work must not be presented as the complete RTS or as completed server-authoritative multiplayer.

The wording-only P2 findings were resolved immediately: the cooldown message now includes settlement advancement, the README lists tier locks, and the changelog labels authoritative multiplayer as a planned architecture document. Separate Codex verification then passed all 65 tests, production builds, the local multiplayer smoke test, dependency audit, and a 568x320 landscape-browser check with no overflow or console errors. Artificer progression for all five AI profiles remains a later test milestone and is not claimed complete.

## Economy carry-and-drop-off slice final review

TASK-006 replaced instant wallet credit with an original deterministic logistics loop: workers carry at most 12 units, deposit only at compatible reachable buildings, retain cargo when routes are blocked, exhaust finite wood and stone nodes, and wait for food fields to renew at the declared tick. Client presentation adds original food-sack, bundled-log and stone-pile vector cargo silhouettes, grouped manual delivery, fallow feedback and fixed-dock controls.

### Grok CLI evidence

- CLI/version: `C:\Users\digimkt\.grok\bin\grok.exe`, `grok 0.2.106 (bde89716f6)`
- Requested model: `grok-4.5`; actual model: `grok-4.5-build`
- Permission: read-only plan mode; web, memory and subagents disabled
- Session: `b0b532a7-6640-4b40-8f2b-6c8140483aef`
- First accepted audit request: `c82eedb1-0b86-409c-80bc-d33d3ff26d1b`, exit `0`, `EndTurn`, verdict `PASS`, P0 `0`, P1 `0`, P2 `2`
- Final targeted closure request: `093b789d-0e62-4484-88e5-7e663700ae33`, exit `0`, `EndTurn`, verdict `PASS`, P0 `0`, P1 `0`, P2 `0`

The two initial P2 observations were closed before handoff. Resource clicks now filter selected workers by a reachable cardinal resource perimeter and a reachable compatible deposit route, preserving blocked workers' existing orders instead of risking an all-or-nothing command rejection. The README now documents the mixed-selection `卸全部` action. Grok re-read those exact changes and reported no regression. Two intermediary Grok requests ended as `Cancelled` while exploring or reaching their turn cap; they were not treated as accepted audit verdicts.

### Independent Codex and delegated-auditor evidence

- `npm run verify`: PASS; client/server/shared typechecks, 5 test files and 77 tests, and production builds all completed.
- `npm run smoke:multiplayer:local`: PASS; two-player room, host/readiness rejection, invalid-payload rejection, reconnect and authoritative tick checks completed.
- `npm audit --omit=dev`: PASS; 0 known production vulnerabilities.
- Playwright production-preview QA: 1280×720, 844×390 and 568×320 landscape layouts rendered in a single viewport; the 568×320 document measured 568×320 and its canvas 568×319, with no overflow and 0 console errors. Worker selection, three-page construction controls and the system panel retained seven non-overlapping action slots.
- A separate read-only client/AI auditor returned P0 `0`, P1 `0`, P2 `0` after checking disconnected same-resource carrier grouping, mixed-resource delivery, all three cargo drawing paths, client typecheck, 77 shared tests and 667×375 layout behavior.

Verdict: **TASK-006 PASS**. This completes only the economy carry/drop-off slice. Technology research, fog of war, walls and gates, complete combat integration, save/replay and server-owned multiplayer battles remain open work and are not claimed complete.

## Technology research slice final review

TASK-027 adds seven original Village Siege technologies, strict research commands, player-global duplicate protection, a single FIFO lane shared with training, deterministic derived effects, distinct five-profile AI priorities and a fixed seven-slot research dock. This is an original classic-RTS system category under MIT; it does not copy another title's names, balance table, interface or assets, and it does not make the unfinished full RTS or server-owned online battle a completed claim.

### Grok CLI evidence

- CLI/version: `C:\Users\digimkt\.grok\bin\grok.exe`, `grok 0.2.106 (bde89716f6)`
- Requested model: `grok-4.5`; actual model: `grok-4.5-build`
- Permission: read-only review instructions; web and memory disabled; Codex verified identical Git status before and after the audit
- Accepted session: `019f7ed5-a760-7d42-8b6c-50c890e2e689`
- Full evidence review: request `87576fde-8f82-4d4f-9508-09d5ac762030`, exit `0`, `EndTurn`, verdict `PASS WITH P2`, P0 `0`, P1 `0`, P2 `3`
- Targeted closure: request `df790bd2-c4ff-45e4-a8c2-4f142aab1e07`, exit `0`, `EndTurn`, verdict **PASS**, P0 `0`, P1 `0`, P2 `0`

The first three P2 findings were all closed before handoff: duplicate research now returns `DUPLICATE_RESEARCH` with a specific client message; a five-profile AI may continue strategic research under visible pressure after fielding at least three military units; and the canonical fallback producer is explicitly sorted by entity ID. The closure added an authoritative-valid pressure regression test and increased the shared suite to 84 passing tests.

### Codex and delegated-auditor evidence

- Final `npm run verify`: PASS with all workspace typechecks, 5 files / 84 tests and client/server production builds.
- `npm run smoke:multiplayer:local`: PASS for two-player room, host/readiness/invalid-payload rejection, reconnect and authoritative tick.
- `npm audit --omit=dev`: PASS, 0 known production vulnerabilities.
- Playwright production-preview QA: 844×390, 667×375 and 568×320 all keep document and canvas within the viewport, expose seven building controls and seven research controls, return with Escape and report zero console or page errors. Visual inspection of the 568×320 research dock found no label overlap.
- Independent shared-rules, AI/test and mobile-UX auditors were used before finalization; their mobile label, queued-research status, completion-notice and cyclic page-number findings were fixed. The final mobile closure reports P0 `0`, P1 `0`, P2 `0`.

Verdict: **TASK-027 PASS**. This completes only the technology research slice. Fog of war, walls and gates, remaining combat commands, save/replay product flow and server-owned multiplayer battles remain open and are not claimed complete.

## Production cancellation and rally slice final review

TASK-028 adds deterministic production job identities, enqueue-time paid-cost snapshots, original progress-weighted cancellation refunds and owner-private building rally points. The fixed seven-slot building dock now reserves four primary actions, one queue action, one rally action and one system action. A five-job queue uses two in-dock pages and stable-ID two-step cancellation; no modal or overlapping mobile panel was added.

Waiting work refunds its full paid cost. Active work refunds `floor(paidCost × remainingTicks / totalTicks)` independently per resource. Destroyed producers still lose their queues without refund. New units spawn from the canonical free perimeter before receiving a rally move order; a rally invalidated by later construction leaves the unit idle and never blocks FIFO production.

### Grok CLI evidence

- CLI/version: `C:\Users\digimkt\.grok\bin\grok.exe`, `grok 0.2.106 (bde89716f6)`
- Requested model: `grok-4.5`; permission: read-only plan mode; web, memory and subagents disabled
- Accepted session: `019f7f27-43de-7762-833e-94e5a3d519c9`
- Full audit prompt id: `5df12d44-0fde-4f66-ac7b-92723e8561b9`; verdict `PASS WITH FINDINGS`, P0 `0`, P1 `1`, P2 `1`
- Targeted closure prompt id: `40c16808-660c-4127-89d1-db0fe519d3ba`; verdict **PASS**, P0 `0`, P1 `0`, P2 `0`

The initial P1 correctly found that AI recovery added queued population to `population.used` even though the authoritative value already includes queued population. The fix compares `used` directly with capacity and adds both a real-overflow stable-tail cancellation test and a `used=8, capacity=10` false-positive regression test. The P2 README gap was closed by documenting the exact Escape hierarchy: confirmation to queue, queue/rally to building commands, building placement cancellation, then battle exit.

### Codex and delegated-auditor evidence

- Final `npm run verify`: PASS with all workspace typechecks, 5 files / 93 tests and client/server production builds.
- `npm run smoke:multiplayer:local`: PASS for two-player room, readiness/host/invalid-payload rejection, reconnect and authoritative tick.
- `npm audit --omit=dev`: PASS, 0 known production vulnerabilities.
- Playwright production-preview QA at 844×390, 667×375 and 568×320 exposed exactly seven controls, kept document and canvas inside the viewport, rendered queue pages 1/2 and 2/2, cancelled only the selected fifth job after confirmation, preserved Escape layers, kept rally targeting active after drag, rendered the legal copper rally marker and reported zero console/page errors.
- Browser QA found one stale-confirmation success-message race. The mode transition now occurs before the accepted cancel is rendered; a rebuilt preview reverified the owner status as `已取消 工匠`.
- Three independent read-only auditors reviewed shared rules, AI/tests and mobile UX before implementation. Their stable job identity, owner-only observation, invalid-rally spawn fallback, fixed dock, two-step confirmation and active/a11y findings were implemented.

Verdict: **TASK-028 PASS**. This completes the production cancellation and rally slice only. Fog of war, walls and gates, remaining combat commands, save/replay product flow and server-owned multiplayer battles remain open and are not claimed complete.
