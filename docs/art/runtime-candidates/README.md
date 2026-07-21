# Runtime action-sheet candidate log

These RGBA sheets are normalized production candidates. They are not release assets until every required facing for the actor exists, the no-mirror comparison passes, the runtime manifest uses the directional set, and browser evidence proves each action and direction.

## Warrior NE v1

- Key-pose source: `docs/art/keyposes/warrior-ne-v1.png`
- Initial alpha extraction: `warrior/ne.png`
- Normalized candidate: `warrior/ne-normalized.png`
- Native runtime candidate: `warrior/ne-runtime.png` (`384x672`, 24 cells at `96x112`, anchor `(48,88)`).
- Cell contract: 4 columns × 6 action rows, 256×256 RGBA cells, fixed visual anchor `(128, 224)`.
- Row order: `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Process: the project image-generation chroma helper produced straight-alpha foreground; `scripts/normalize-directional-action-sheet.mjs` separated connected foreground components, removed cross-cell bleed, preserved all 24 independently authored poses, applied bounded uniform frame scaling, and placed every frame on the fixed anchor.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: `node scripts/validate-directional-action-sheets.mjs docs/art/runtime-candidates/warrior/ne-normalized.png` passes with 24 unique frames, 73.7% transparent canvas, no non-black fully transparent RGB, and every foreground bounding box inside the 2px safety border.
- Native validator evidence: `node scripts/validate-directional-action-sheets.mjs --cell-width 96 --cell-height 112 --edge-padding 1 docs/art/runtime-candidates/warrior/ne-runtime.png` passes; file size is 223,668 bytes.
- Remaining gates: normalized `E`, `NW`, `W`, `SW`, and `SE` sheets; inter-facing identity and no-mirror checks; projectile frames; directional runtime loader; in-browser animation and pivot evidence.

The unnormalized `warrior/ne.png` is retained as process evidence and intentionally fails the cell-border validator. It must not be loaded by the game.

## Warrior SW v1

- Key-pose source: `docs/art/keyposes/warrior-sw-v1.png`
- Initial alpha extraction: `warrior/sw.png`
- Normalized candidate: `warrior/sw-normalized.png`
- Native runtime candidate: `warrior/sw-runtime.png` (`384x672`, 24 cells at `96x112`, anchor `(48,88)`).
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 78.7% transparent canvas, no non-black fully transparent RGB, and all frame bounds inside the 2px safety border.
- Native validator evidence: 24 unique frames, 71.6% transparent canvas, all frame bounds inside the 1px safety border, and a 233,205-byte file.
- Direction evidence: independently authored SW front-left three-quarter silhouettes; no frame is derived by flipping the NE source.

## Warrior E/W/NW native candidates

| Facing | Alpha source | Native candidate | Size | Cell validator |
| --- | --- | --- | ---: | --- |
| E | `warrior/e.png` | `warrior/e-runtime.png` | `384x672` | 24 unique frames; 74.3% transparent; passed |
| W | `warrior/w.png` | `warrior/w-runtime.png` | `384x672` | 24 unique frames; 73.8% transparent; passed |
| NW | `warrior/nw.png` | `warrior/nw-runtime.png` | `384x672` | 24 unique frames; 72.3% transparent; passed |

All use `96x112` cells, anchor `(48,88)`, black RGB under fully transparent pixels, and a 1px validator safety border. They remain candidates until the SE sheet and six-facing no-mirror/runtime/browser gates pass.

## Mage NE v1

- Key-pose source: `docs/art/keyposes/mage-ne-v1.png`
- Initial alpha extraction: `mage/ne.png`
- Normalized candidate: `mage/ne-normalized.png`
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 75.4% transparent canvas, no non-black fully transparent RGB, and all frame bounds inside the 2px safety border.
- Remaining gates: five independently authored facings, arcane projectile frames, inter-facing identity checks, directional runtime integration, and browser evidence.

## Shield-bearer NE v1

- Key-pose source: `docs/art/keyposes/shield-bearer-ne-v1.png`
- Initial alpha extraction: `shield-bearer/ne.png`
- Normalized candidate: `shield-bearer/ne-normalized.png`
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 83.2% transparent canvas, no non-black fully transparent RGB, and all frame bounds inside the 2px safety border.
- Remaining gates: five independently authored facings, inter-facing identity checks, directional runtime integration, and browser evidence.

## Warrior six-facing production gate

- Review status: **PASSED FOR RUNTIME PRODUCTION**
- Runtime location: `apps/client/public/assets/original/units/warrior/sprites/facings/`
- Facing order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Contract: six independent `384x672` RGBA sheets; each sheet contains 24 cells at `96x112`, with anchor `(48,88)` and row order `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Static gate: `npm run validate:directional-art` passes all 144 frames, with no empty/duplicate cells, no exact cross-facing reuse, no exact horizontal-mirror reuse, clean transparent RGB, and safe cell bounds.
- Manifest gate: the Node-based regression test proves six unique runtime paths and texture keys; `validateCombatAnimationManifest()` requires complete, unique facing declarations.
- Runtime gate: `FrameAnimatedCombatActor` switches to `unit-action-sheet-warrior-{facing}` and keeps `flipX=false` for every directional sheet.
- Browser matrix: `output/playwright/warrior-runtime-full-action-matrix.json` passes 36/36 facing/action transitions across `idle`, `walk`, `attack`, `hurt`, `death`, and `cast`; every action advances from frame 0 to frame 1, maps to rows `0..5` in that exact order, uses a `96x112` cut, and keeps `flipX=false`.
- Gameplay transition matrix: `output/playwright/warrior-runtime-gameplay-transition-matrix.json` passes six movement facings and six attack facings with the expected texture key and `flipX=false`.
- Network/decode gate: `output/playwright/warrior-facing-http-decode.json` reports six HTTP 200 PNG responses, six successful browser decodes, and exact `384x672` dimensions.
- Error gate: `output/playwright/warrior-runtime-error-audit.json` records zero page errors, zero console errors, zero art-load failures, and a ready warrior actor in `CombatShowcaseScene`.
- Visual evidence: `output/playwright/warrior-runtime-{e,ne,nw,w,sw,se}-idle-frame1.png`, plus NE walk/hurt/death/cast and E attack frame-1 captures.

This closes the warrior migration only. Archer, mage, musketeer, shield-bearer, boar rider, heavy crossbow, and all three monsters remain on the independently authored six-facing roadmap and must not inherit this approval.
