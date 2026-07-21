# Village Siege v0.19.0 release audit

Date: 2026-07-22 (Asia/Taipei)

## Decision

**APPROVE for the v0.19.0 source, single-player Pages build, self-hosting templates, archer six-facing migration, and deterministic allied movement reservations.**

- Codex independent final audit: `P0=0 P1=0 P2=0`.
- Grok CLI initial read-only audit session `019f8658-5fb4-7633-8b09-595b001a60da`: `REJECT` because production version defaults were stale and two reservation semantics lacked dedicated committed regressions.
- Codex corrected every finding: app/protocol/rules documentation and production tags now agree; cross-player same-team and surrendered-player reservation regressions were added; sharp attribution and the architecture rules string were clarified.
- Grok CLI read-only re-audit session `019f8661-3e53-7cd1-9e2d-21f1c756ae87`: **`P0=0 P1=0 P2=0 APPROVE`**.

The permanent public WSS host and public two-client live gate remain explicitly open under TASK-026. GitHub Pages keeps multiplayer disabled by default; this audit does not claim that the public multiplayer service is live.

## Gameplay and determinism gates

- Shared typecheck: passed.
- Shared simulation: 89/89 passed, including canonical team reservations, 40 units through a two-cell gate within 600 ticks, construction/gather/delivery/repair approaches, charge and push clipping, burn death, combat death, cross-player allies, surrendered players, enemy semantics, and replay-equal final hashes.
- Shared full suite: 12 files, 234/234 tests passed.
- Five AI personalities: unchanged 18,000-tick gate passed; no timeout was extended.
- Client: 85/85 tests passed.
- Server: 86/86 tests passed.
- Operations tests: 4/4 passed.
- `npm run verify`: passed, including the production client build.

## Archer and browser gates

- Six independent archer runtime sheets at `384x672`, 24 cells per direction, passed the static validator with no exact or horizontal-mirror cross-facing reuse.
- `output/playwright/archer-runtime-facing-action-matrix.json`: 36/36 direction/action states passed with `flipX=false`.
- `output/playwright/archer-facing-http-decode.json`: six HTTP 200 responses, successful browser decode, exact dimensions.
- Browser error evidence records zero page, console, request, and scene-asset failures.
- `output/playwright/village-assault-mobile-844x390.json`: the real click path entered only `VillageAssaultScene`; the default HUD and live worker-to-build-menu flow each exposed seven visible controls with zero overlap and zero out-of-bounds controls.

## Release and compliance gates

- Release compliance: 44/44 assets hashed, 15 attribution rows, 20 approved runtime art files, no secret finding, and allowed production dependency licenses.
- Runtime bundle after the required `prune:runtime-art` step: 27 files, 20 approved PNGs, 15,350,321 bytes; validation passed.
- Production dependency audit: 0 vulnerabilities.
- Version triple: app `0.19.0`, protocol `village-siege-network/4`, rules `village-siege/0.18.0`.
- Production Compose client/server defaults and `production.env.example` select tag `0.19.0`; the operations validator now guards this default.

## Cleanup record

No project or release artifact was deleted. Two rejected SE process candidates remain outside the repository in the Windows system Temp directory because the host execution policy rejected both exact `Remove-Item -LiteralPath` attempts:

- `C:\Users\digimkt\AppData\Local\Temp\village-siege-rejected-se-source-v1.png` (2,402,121 bytes)
- `C:\Users\digimkt\AppData\Local\Temp\village-siege-rejected-se-alpha-v1.png` (1,117,117 bytes)

They are not tracked, referenced, built, copied into `dist`, or published. The accepted source, runtime sheets, hashes, browser evidence, and audit records were retained.
