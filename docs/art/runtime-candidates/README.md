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

## Archer E v1

- Generated source: `archer/e-source-v1.png` (`1024x1536`, SHA-256 `e2fd20ea3c97f299686c7b388c570c87952451fb50cadb3268adbdaadeaaa9ab5`).
- Alpha source: `archer/e-alpha-v1.png` (SHA-256 `cabba4119c762debb0c50293098f49911123d050e85956bed47df365cadf5425`).
- Native runtime candidate: `archer/e-runtime-v1.png` (`384x672`, SHA-256 `488bbb308b1f5a3deeebbb6d96c9c77b5b7f4df439236fd917617ba33afc9074`).
- Contract: 24 independently authored E-facing cells at `96x112`, anchor `(48,88)`, with rows `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Process: built-in image generation used the approved Archer v2 turnaround, original archer action source and validated NE native candidate as identity/action/runtime references; the image-generation chroma helper removed the flat magenta backdrop before the standard normalization script applied the fixed anchor and native cell size.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 75.5% transparent canvas, clean safe bounds, and no exact or horizontally mirrored frame reuse against `archer/ne-runtime.png`.
- Remaining gates: six-facing runtime promotion and browser evidence. Projectile visuals remain an independent runtime effect contract.

## Archer W v1

- Generated source: `archer/w-source-v1.png` (`1024x1536`, SHA-256 `c587f3bc95e993257e6d511193043e6b64d84d538ea38863c9138d34cf39f42a`).
- Alpha source: `archer/w-alpha-v1.png` (SHA-256 `5fa834720b4cecc0ff10de6c69086ab84e4af24d08369dae2ae2cb5838abd056`).
- Native runtime candidate: `archer/w-runtime-v1.png` (`384x672`, SHA-256 `abb6db8cf74eed4c823108f6048c2d3a214f0aa0ccb1d2ed3ef98b11bbe85bfe`).
- Contract: 24 independently authored W-facing cells at `96x112`, anchor `(48,88)`, with rows `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 75.0% transparent canvas, safe bounds, and no exact or horizontally mirrored frame reuse across the approved Archer E, NE and W candidates.
- Remaining gates: six-facing runtime promotion and browser evidence. Projectile visuals remain an independent runtime effect contract.

## Archer NW v1

- Generated source: `archer/nw-source-v1.png` (`1024x1536`, SHA-256 `d869abb374a9913146bfdbed011fee8cccce3dfcefc1168aeac2e4e8516d9317`).
- Alpha source: `archer/nw-alpha-v1.png` (SHA-256 `fcde8ffcf2f92328e9b199df992b65e640561e896460a4f2dc8a41ca616857a6`).
- Native runtime candidate: `archer/nw-runtime-v1.png` (`384x672`, SHA-256 `19425221fc1d9be1251f06a374e9912b512c773754e2ebabdea8492d9f24f6e9`).
- Contract: 24 independently authored NW-facing cells at `96x112`, anchor `(48,88)`, with rows `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 75.2% transparent canvas, safe bounds, and no exact or horizontally mirrored frame reuse across the approved Archer E, NE, NW and W candidates.
- Visual note: the hurt-row third cell keeps the longbow as a separate silhouette close to the drawing hand; it passed cell safety but remains a browser-scale review item before production promotion.

## Archer SW v1

- Generated source: `archer/sw-source-v1.png` (`1024x1536`, SHA-256 `e0699bbcb9dd23ab5f57b514fe330d0b651069b1d43905d6ccb06b2b4a18c1c0`).
- Alpha source: `archer/sw-alpha-v1.png` (SHA-256 `0d09ba0dd3a147c02d8ad43aea193ae723c9f3e4b85888a784ab6eb23d5e8375`).
- Native runtime candidate: `archer/sw-runtime-v1.png` (`384x672`, SHA-256 `5503fcfa0f8a299a393b8b718e6ce82d915e348b0fdfc133b0653da68492808b`).
- Contract: 24 independently authored SW-facing cells at `96x112`, anchor `(48,88)`, with rows `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: 24 unique frames, 74.1% transparent canvas, safe bounds, and no exact or horizontally mirrored frame reuse across the approved Archer E, NE, NW, W and SW candidates.
- Generation audit: the first SW source was rejected because attack recovery omitted the bow; only the corrected source was retained and normalized.

## Archer SE v1

- Independent source: the existing production-authored `apps/client/public/assets/original/units/archer/sprites/action-sheet-source.png` (`1024x1536`, SHA-256 `b6aaa683e0a61eabfeaa458e514d449dd507f101b4966017028dd5d2e068b9a3`), which is an SE front-right drawing rather than a mirror of another facing.
- Preserved transparent source: `archer/se-original-action-sheet-v1.png` (SHA-256 `8592695a51b4bc1f9bdb0d93fe5e4f2ecba8ee4081c01cb1fe8599b7bfc9694a`).
- Clean original-order normalization: `archer/se-runtime-original-order-v1.png` (`384x672`, SHA-256 `649992acf4e1b05be75830292ddd0484f71af1bfc1f1c8677fea6afb489464e5`).
- Native runtime candidate: `archer/se-runtime-v1.png` (`384x672`, SHA-256 `145871d9890b2e98cacdb3051025d11f164e47b4b4508842e8e858bd9a99f578`).
- Process: normalize the transparent source before moving rows, then reorder semantic rows from legacy `idle/walk/attack/cast/hurt/death` to runtime `idle/walk/attack/hurt/death/cast`. This prevents cross-row foreground fragments while retaining the independently authored pixels.
- Review status: **SIX-DIRECTION STATIC GATE PASSED; BROWSER GATE PENDING**
- Validator evidence: all six Archer sheets contain 24 unique frames, clean transparent RGB and safe bounds; the final SE sheet is 73.5% transparent and the six-sheet set has no exact or horizontally mirrored cross-facing reuse.
- Generation audit: a newly generated SE draft was rejected for missing bows and a detached projectile; three correction attempts stalled and were stopped. The rejected draft never entered the repository or runtime.

## Shield-bearer NE v1

- Key-pose source: `docs/art/keyposes/shield-bearer-ne-v1.png`
- Initial alpha extraction: `shield-bearer/ne.png`
- Normalized candidate: `shield-bearer/ne-normalized.png`
- Native runtime candidate: `shield-bearer/ne-runtime-v1.png` (`448x672`, 24 cells at `112x112`, anchor `(56,88)`).
- Review status: **RUNTIME-CELL VALIDATION PASSED; PROMOTED WITH THE COMPLETE DIRECTION SET**
- Validator evidence: 24 unique frames, 74.7% transparent canvas, no non-black fully transparent RGB, and all frame bounds inside the 1px safety border.
- The complete production gate and browser evidence are recorded below.

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

This section closes the warrior migration only. Mage, musketeer, boar rider, heavy crossbow, and all three monsters remain on the independently authored six-facing roadmap; shield-bearer is closed separately below.

## Archer six-facing production gate

- Review status: **PASSED FOR RUNTIME PRODUCTION**
- Runtime location: `apps/client/public/assets/original/units/archer/sprites/facings/`
- Facing order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Contract: six independently authored `384x672` RGBA sheets; each sheet contains 24 cells at `96x112`, with anchor `(48,88)` and row order `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Static gate: `npm run validate:directional-art` passes the archer's 144 frames, with no empty/duplicate cells, no exact cross-facing reuse, no exact horizontal-mirror reuse, clean transparent RGB, and safe cell bounds.
- Manifest gate: the Node-based regression test proves six unique runtime paths and texture keys; `validateCombatAnimationManifest()` requires complete, unique facing declarations.
- Runtime gate: `FrameAnimatedCombatActor` switches to `unit-action-sheet-archer-{facing}` and keeps `flipX=false` for every directional sheet.
- Browser matrix: `output/playwright/archer-runtime-facing-action-matrix.json` passes 36/36 facing/action transitions across `idle`, `walk`, `attack`, `hurt`, `death`, and `cast`; every action advances from frame 0 to frame 1, maps to rows `0..5` in that exact order, uses a `96x112` cut, and keeps `flipX=false`.
- Network/decode gate: `output/playwright/archer-facing-http-decode.json` reports six HTTP 200 PNG responses, six successful browser decodes, and exact `384x672` dimensions.
- Error gate: `output/playwright/archer-runtime-error-audit.json` records zero page errors, zero console errors, zero request failures, and zero scene art failures.
- Visual evidence: `output/playwright/archer-runtime-e-attack-frame1.png`, `output/playwright/archer-runtime-nw-walk-frame1.png`, `output/playwright/archer-runtime-se-cast-frame1.png`, and `output/playwright/archer-runtime-representative-states.json`.

This section closes the warrior and archer migrations. Mage, musketeer, boar rider, heavy crossbow, and all three monsters remain on the independently authored six-facing roadmap; shield-bearer is closed separately below.

## Shield-bearer six-facing production gate

- Review status: **PASSED FOR RUNTIME PRODUCTION**
- Runtime location: `apps/client/public/assets/original/units/shieldBearer/sprites/facings/`
- Facing order: `E`, `NE`, `NW`, `W`, `SW`, `SE`; all six are independently generated and are not horizontal mirrors.
- Contract: six independent `448x672` RGBA sheets; each contains 24 cells at the art-bible `112x112` size, anchor `(56,88)`, and rows `idle`, `walk`, `attack`, `hurt`, `death`, `brace` (runtime action name `cast`).
- Static gate: the six-sheet validator passes all 144 cells with no empty/duplicate cells, exact cross-facing reuse, exact horizontal-mirror reuse, dirty transparent RGB, or unsafe bounds.
- Identity gate: all directions retain the same shield arm, short-spear hand, oval wood/wicker shield, quilted coat, helmet and belt kit; the rejected legacy mace sheet is preserved only as `shield-bearer/legacy-mace-action-sheet-v1.png` and is no longer a public runtime asset.
- Manifest gate: the client exposes six unique texture keys and paths, uses `112x112`, anchor `(56,88)`, `artScale=1`, and never falls back to horizontal flipping.
- Browser matrix: `output/playwright/shieldbearer-runtime-facing-action-matrix.json` passes 36/36 facing/action transitions, advances every action, maps to rows `0..5`, uses a `112x112` cut and keeps `flipX=false`.
- Network/decode gate: `output/playwright/shieldbearer-facing-http-decode.json` records six HTTP 200 PNG responses, six successful decodes and exact `448x672` dimensions.
- Error and visual gates: `output/playwright/shieldbearer-runtime-error-audit.json` records zero page, console, request and scene-asset failures; representative E attack, NW walk and SE brace captures are retained beside it.

This closes the warrior, archer and shield-bearer migrations only. Mage, musketeer, boar rider, heavy crossbow and all three monsters remain on the independently authored six-facing roadmap.
