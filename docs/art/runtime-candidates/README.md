# Runtime action-sheet candidate log

These RGBA sheets are normalized production candidates. They are not release assets until every required facing for the actor exists, the no-mirror comparison passes, the runtime manifest uses the directional set, and browser evidence proves each action and direction.

## Warrior NE v1

- Key-pose source: `docs/art/keyposes/warrior-ne-v1.png`
- Initial alpha extraction: `warrior/ne.png`
- Normalized candidate: `warrior/ne-normalized.png`
- Cell contract: 4 columns × 6 action rows, 256×256 RGBA cells, fixed visual anchor `(128, 224)`.
- Row order: `idle`, `walk`, `attack`, `hurt`, `death`, `cast`.
- Process: the project image-generation chroma helper produced straight-alpha foreground; `scripts/normalize-directional-action-sheet.mjs` separated connected foreground components, removed cross-cell bleed, preserved all 24 independently authored poses, applied bounded uniform frame scaling, and placed every frame on the fixed anchor.
- Review status: **RUNTIME-CELL VALIDATION PASSED; DIRECTION SET INCOMPLETE**
- Validator evidence: `node scripts/validate-directional-action-sheets.mjs docs/art/runtime-candidates/warrior/ne-normalized.png` passes with 24 unique frames, 73.7% transparent canvas, no non-black fully transparent RGB, and every foreground bounding box inside the 2px safety border.
- Remaining gates: normalized `E`, `NW`, `W`, `SW`, and `SE` sheets; inter-facing identity and no-mirror checks; projectile frames; directional runtime loader; in-browser animation and pivot evidence.

The unnormalized `warrior/ne.png` is retained as process evidence and intentionally fails the cell-border validator. It must not be loaded by the game.
