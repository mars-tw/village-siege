# Village Siege v2 release audit

Date: 2026-07-19

Branch: `codex/village-rts-v2`

Final verdict: **PASS WITH P2** — no P0 or P1 release blocker remains.

## Verification

- `npm run verify`: passed across all workspaces.
  - TypeScript typecheck: passed for client, server, and shared.
  - Shared tests: **5 files / 57 tests passed**.
  - Production builds: passed for client, server, and shared.
- `git diff --check`: passed; only Windows LF-to-CRLF notices were emitted.
- Vite produced a non-blocking bundle-size warning for the main client chunk
  (about 1.68 MB minified / 454 KB gzip).
- Existing 568x320 browser evidence measured the action targets at about
  **52.2 CSS px**, above the 44 CSS px mobile acceptance threshold.

## Grok CLI independent review

- CLI: `grok 0.2.101 (5bc4b5dfad) [stable]`
- Model: `grok-4.5`, high reasoning, `plan` permission mode (read-only)
- Conversation: `019f7ada-277a-7812-b359-4c5b9f3653d0`
- Grok's first pass correctly found that producer spawns did not filter
  unwalkable terrain and returned `FAIL` with one P1.
- After the fix, Grok reopened the latest files and issued an amendment of
  **PASS**, explicitly confirming all three remediations:
  1. producer perimeter candidates now require `isMapCellWalkable`;
  2. building context actions use at most six contextual slots and always put
     `systemAction` in slot seven;
  3. failed lazy-loaded unit art receives a five-second automatic retry for
     both queued units and already spawned AI units.

The final project verdict is slightly stricter than Grok's amendment because
the remaining P2 items below are release-quality debt even though they do not
block publication.

## Findings

### P0

None.

### P1

None. The three candidate blockers found during review were fixed and included
in the passing verification run:

- village-map AI move/patrol commands now select terrain-safe waypoints, with a
  4,000-tick, five-personality, zero-rejection regression test;
- producer spawns now reject water and rock cells;
- the seven-slot building context dock always retains the System action, while
  lazy art failures automatically retry instead of leaving AI units invisible.

### P2

1. **Some UI regression coverage remains manual.** A focused simulation test
   now places a producer beside water and proves the trained unit selects a
   walkable perimeter cell. The seven-slot building dock and five-second
   lazy-loader recovery are still verified structurally/browser-manually rather
   than by automated UI regression tests.
2. **The main bundle remains large.** Vite still warns about the main client
   chunk. The one-time `output/playwright/v2-rts/` audit files were removed
   before publication.

## Focus-area decision table

| Focus | Result | Evidence |
| --- | --- | --- |
| Shared terrain / footprint / path | Pass | Shared battlefield authority, multi-cell validation, deterministic four-way BFS, and village-map tests pass. |
| Producer rules / five AI profiles | Pass | Each unit uses its declared producer; all five profiles complete a 4,000-tick village-map legality run without rejected commands. |
| Lazy-loader race / failure | Pass with P2 | Promise coalescing, generation checks, filtered loader events, no primitive fallback, and automatic retry are present; failure-retry UI automation is still absent. |
| Three pages / seven slots / 568x320 | Pass with P2 | Three build pages remain in a single dock, System occupies slot seven, and measured touch size is 52.2 CSS px. |
| Portrait blocker | Pass | Portrait mobile mode sets `orientationBlocked`, stops simulation updates, and activates a full-screen interactive blocker. |
| Version / docs | Pass | Root/client/server/shared are 0.2.0, `RULES_VERSION` is `village-siege/0.2.0`, and the navigation wording matches the UI. |

## Release decision

There is **no release blocker** in the audited v2 diff. It is safe to proceed
after the owner accepts the documented P2 debt; the highest-value follow-up is
adding automated UI coverage for the seven-slot dock and lazy-load retry before
later gameplay work expands the same systems.
