# Warrior six-facing runtime audit — 2026-07-22

## Scope

This gate covers the original warrior migration from one mirrored action sheet to six independently authored `E/NE/NW/W/SW/SE` runtime sheets. It does not approve the remaining units or monsters.

## Blocking findings and resolutions

1. The initial browser matrix covered only `idle`, `walk`, and `attack`. Static review then found that the manifest ordered the last three rows as `cast/hurt/death`, while the authored sheets are `hurt/death/cast`.
   - Resolution: the pure manifest contract now locks `idle 0 / walk 1 / attack 2 / hurt 3 / death 4 / cast 5`.
   - Regression: `apps/client/test/combatAnimationManifest.test.ts` asserts the full row mapping.
   - Browser proof: `output/playwright/warrior-runtime-full-action-matrix.json` passes all 36 facing/action combinations.
2. GitHub Pages still used direct recursive shell deletion and did not validate the final runtime bundle.
   - Resolution: Pages, source CI, and the client Docker build now use the bounded `scripts/prune-runtime-art.mjs`; Pages and source CI then run `validate:runtime-assets`.
3. Runtime asset counts were partially hard-coded.
   - Resolution: both container checks derive the expected PNG count from `assets/release-asset-manifest.json`.

## Automated evidence

- Client tests: `84/84` passed.
- Server tests: `86/86` passed.
- Shared simulation tests: `224/224` passed.
- Operations tests: `3/3` passed.
- Directional art: six sheets, 144 valid frames, no exact duplicates, no exact cross-facing reuse, and no exact horizontal-mirror reuse.
- Release compliance: `39/39` assets hashed, 15 approved runtime PNGs, no secret findings, PASS.
- Pruned runtime bundle: 22 files, 15 approved PNGs, `15,183,968` bytes, PASS.
- Production dependency audit: zero vulnerabilities.
- Production build: PASS; the DEV audit hook is absent from the production bundle.

## Real-browser evidence

- `output/playwright/warrior-facing-http-decode.json`: six HTTP 200 PNG responses, six browser decodes, all `384x672`.
- `output/playwright/warrior-runtime-full-action-matrix.json`: 36/36 direction/action rows pass, frame `0→1`, `96x112` cuts, independent texture keys, `flipX=false`.
- `output/playwright/warrior-runtime-gameplay-transition-matrix.json`: movement 6/6 and attack 6/6 pass.
- `output/playwright/warrior-runtime-error-audit.json`: page errors 0, console errors 0, art-load failures 0.
- Visual captures include all six idle facings plus NE walk/hurt/death/cast and E attack.

## Independent review

- Codex delegated compliance review: initial FAIL identified the action-row and Pages pruning defects; post-fix gates passed.
- Grok CLI session `7d5c6e89-8ce7-4f2d-bf98-7c0e1b3a6d42`: final independent result **PASS**, with no blocker, high, or medium findings.

## Remaining product scope

Archer, mage, musketeer, shield-bearer, boar rider, heavy crossbow, Miremaw, Ashwing, and Rootback still require independently authored six-facing action sheets and the same static/runtime/browser gates. Permanent public authoritative WSS hosting remains a separate deployment gate.
