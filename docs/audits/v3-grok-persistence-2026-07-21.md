# TASK-016 persistence and replay audit — 2026-07-21

## Decision

TASK-016 is approved and complete. The final frozen-tree gate has no open P0, P1 or P2 findings from either the independent Codex reviewer or the Grok CLI reviewer.

## Scope

Village Siege v0.13.0 owner-private save snapshots, operation journals, deterministic replay import/export, strict compatibility rejection, runtime continuation metadata and fixed seven-slot mobile controls.

## Implemented contract

- Every save, journal and replay declares an exact schema, protocol and rules version plus `authoritative-private` visibility.
- The journal records accepted human and AI commands, committed AI authority and fixed-step advances in actual order. Every operation carries canonical pre/post hashes.
- Replay restores AI authority at its recorded commit point, validates it against the current players, map and tick, replays commands through the normal validator, and validates the complete reconstructed final state.
- Final runtime metadata preserves rejected-attempt sequence gaps, the sub-tick accumulator and deterministic AI budget. A continuation hash binds those fields to the final state hash.
- Untrusted JSON is bounded by bytes, depth, nodes, string size, operation count, tick and map size. Dangerous prototype keys, invalid registry values/references, impossible projectile combinations, invalid victory state, non-canonical state and incompatible versions are rejected before runtime replacement.
- Generated entity ID high-water validation is schema-aware. It covers retained entity references across advancement, orders, combat, statuses, projectiles, fog and AI state while keeping player IDs in their separate legal namespace.
- Trusted replay serialization is mutation-checked and bounded, including nested mutation and cyclic-object rejection.
- Phaser retains exactly seven reusable Canvas controls. The bounded data subpage provides save/replay import/export, journal export, format help and back navigation; the end state provides rematch, replay download and return without a modal.

## Review history and remediation

1. The initial Grok review identified impossible persisted projectile forms and inconsistent victory winners. Persisted hitscan traces are now rejected; area/line projectiles require their exact legal unit, profile, ability and resolution; eliminated or missing winners are rejected.
2. The first independent Codex review found insufficient replay AI context validation, projectile semantic gaps, winner consistency gaps, generated-ID high-water omissions, stale-building footprint validation and trusted nested-mutation handling. Each class received strict validation and regression coverage.
3. The second independent Codex review found player-ID namespace false positives, missing retained advancement/AI references, future AI authority timestamps, persisted hitscan acceptance and cyclic trusted serialization. The collector became schema-aware, AI ticks became state-relative, and trusted serialization gained bounded cycle-safe validation.
4. The independent Codex final re-audit returned **APPROVE — P0 none, P1 none, P2 none**.
5. Grok's final audit returned **APPROVE — P0 none, P1 none** with two P2 cleanup items: an unused AI validation context field and live-building footprint bounds. Both were fixed, a live-building corner regression was added, and the Grok patch recheck returned **APPROVE — P0 none, P1 none, P2 none**.

## Automated evidence

- Final `npm run verify`: all workspace typechecks, client 19/19, shared 205/205 and production client/server builds passed. The only build note is the existing Vite chunk-size advisory.
- Persistence gate: 18/18. It records an accepted attack, a real AI reducer authority commit and combat damage/removal across 10,000 fixed advances, then replays the history twice to the identical state and hash within the 4 MiB replay limit.
- Post-remediation targeted gate: persistence 18/18 and shared typecheck passed after the two final Grok P2 cleanups.
- `npm run smoke:multiplayer:local`: PASS; existing two-player room, validation, reconnect and authoritative lobby-clock behavior remained intact.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: PASS.
- Repository secret-pattern scan: no matches.

## Browser and mobile evidence

Real Chromium checks passed at 568×320, 667×375, 844×390 and 1280×720. The seven data controls remained inside the fixed dock without overlap or overflow. Real Canvas pointer input opened and closed the subpage; save and replay downloads completed; both formats re-imported successfully; replay import continued for two seconds without console errors or warnings. Temporary screenshots and downloaded archives were moved to the Windows Recycle Bin after inspection.

## Grok CLI evidence

- Initial/final audit lineage: session `019f8175-62d6-7150-ad09-8560b1ceff06`.
- Strict final re-audit and post-remediation patch recheck: session `019f81c4-d32d-78b3-a225-eba1a754214d`.
- Both runs were read-only. Codex approved only explicit read/search commands; Grok did not edit the repository.

The final recheck specifically confirmed removal of the unused `entityIds` validation field, shared full-footprint bounds validation for live buildings and stale sightings, and the new out-of-bounds live-building regression.
