# Village Siege v0.20.0 shield-bearer release audit

Date: 2026-07-22 (Asia/Taipei)

## Scope and current verdict

This release migrates the original shield-bearer from one conflicting legacy mace sheet to six independently authored spear-and-shield facings. The v0.20 source and local single-player build are release candidates only until the final Grok CLI re-audit, remote CI, Pages deployment and public asset probes pass.

This audit does not claim the complete product goal is finished. Mage, musketeer, boar rider, heavy crossbow, three monsters, environment/building art, the animation-quality expansion and permanent public WSS live gate remain open.

## Art and runtime contract

- Runtime facings: `E`, `NE`, `NW`, `W`, `SW`, `SE` under `apps/client/public/assets/original/units/shieldBearer/sprites/facings/`.
- Each facing is a `448x672` RGBA sheet containing 24 cells at `112x112`, anchor `(56,88)` and `artScale=1`.
- Rows are `idle`, `walk`, short-spear `attack`, shield-led `hurt`, chronological `death`, and shield-wall `brace` (runtime action name `cast`).
- The six sheets preserve one shield arm, one short-spear hand, helmet, quilted coat, oval wood/wicker shield, belt kit and material palette without exact mirroring.
- The legacy mace sheet is retained only as `docs/art/runtime-candidates/shield-bearer/legacy-mace-action-sheet-v1.png`; it is absent from the public asset tree and release manifest.

## Static and manifest gates

- The native validator passes all 144 cells: 24 unique cells per sheet, clean transparent RGB, safe bounds, and no exact or horizontally mirrored cross-facing reuse.
- `combatAnimationManifest.test.ts` proves six unique paths/texture keys, `112x112`, anchor `(56,88)`, `artScale=1`, and complete directional declarations.
- Release compliance hashes 49/49 declared assets, permits 25 runtime PNGs totaling 13,561,954 bytes under the 16 MiB budget, verifies 119 production dependency licenses and finds zero secret-scan findings.
- The runtime allowlist pruner removes any public-build PNG that is not an approved runtime manifest entry. Its regression proves the stale shield-bearer `action-sheet.png` and build-only source are rejected while approved facings survive.
- A pruned production build validates 32 files, exactly 25 approved PNGs and 15,636,245 total bytes.
- Full suites pass: client 85/85, server 86/86, shared 234/234 and operations 5/5.

## Real browser gates

- `output/playwright/shieldbearer-runtime-facing-action-matrix.json`: 36/36 direction/action transitions pass; frames advance, semantic rows match, each texture key is direction-specific and `flipX=false`.
- `output/playwright/shieldbearer-facing-http-decode.json`: all six files return HTTP 200, decode as PNG and report exact `448x672` dimensions.
- `output/playwright/shieldbearer-runtime-error-audit.json`: zero page errors, console errors, request failures and scene asset failures.
- Representative captures: E attack, NW walk and SE brace in the live `CombatShowcaseScene`.

## Version and deployment truth

- Version triple: app `0.20.0`, protocol `village-siege-network/4`, rules `village-siege/0.18.0`.
- Production Compose and `production.env.example` default to tag `0.20.0`; the operations validator guards this value.
- GitHub Pages must keep multiplayer disabled until a permanent public WSS service passes the two-browser live gate.
- Current infrastructure audit found no repository deployment variables or secrets, no production environment, no active public host/DNS, and an expired local gcloud credential. Static Pages cannot satisfy the WSS requirement.

## Independent review

- Codex pre-release review: static, unit, browser and runtime bundle gates above pass; GitHub publication gates remain pending.
- Grok CLI initial read-only audit session `019f86b5-17c4-7c13-b468-c4a8bccb6fae`: `P0=2 P1=1 P2=1 REJECT`.
- Codex fixed both release blockers: the client Docker builder now copies the pruner policy and release manifest, and container CI derives the expected app version from root `package.json` instead of pinning `0.19.0`.
- Codex fixed the documentation contradiction, added operations checks for the Docker/pruner dependencies and dynamic CI version assertion, and staged all required runtime assets, policy and tests.
- Grok CLI final read-only re-audit in session `019f86b5-17c4-7c13-b468-c4a8bccb6fae`: all four prior findings confirmed fixed; operations 5/5, release compliance, six-sheet validator and runtime-art-policy samples pass; `P0=0 P1=0 P2=0 APPROVE`.
