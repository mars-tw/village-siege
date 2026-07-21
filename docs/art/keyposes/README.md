# Combat key-pose review log

These are original production references, not runtime sprite atlases. Approval here means only that the pose language may proceed to the opposite-facing comparison and later native-resolution frame cleanup.

## Warrior SE v1

- File: `warrior-se-v1.png`
- Reference: approved `docs/art/turnarounds/warrior-six-facing-v2.png` plus the approved warrior action-sheet source.
- SHA-256: `69604d8432a30aadb0eb982265d07fac7cebf37b7d3d44d0d85fd69b9095d79b`
- Dimensions: `1024x1536`
- Review status: **APPROVED FOR NW COMPARISON**
- Pose inventory: idle 2, walk 4, attack 4, hurt 2, death 4, special cleave 4.
- Passed: distinct walk contacts, readable attack anticipation/commit/recovery, terminal grounded death, full-body silhouette, consistent SE camera, and visible broad-blade motion.
- Still required: NW pose comparison, remaining four facings, frame interpolation, transparent native-resolution cells, pivot/foot-slide validation, and runtime/browser QA.

Do not add this sheet to the production preload or release asset manifest.

## Warrior NW v1

- File: `warrior-nw-v1.png`
- Reference: approved warrior turnaround, approved SE action rhythm, and the approved warrior action-sheet source.
- SHA-256: `a41f36c72eff2b6e16031c6725e85306b69c6699629d70f7fcc0a2ec79b5aa9c`
- Dimensions: `1536x1024`
- Review status: **APPROVED — SE/NW KEY-POSE GATE PASSED**
- Pose inventory: idle 2, walk 4, attack 4, hurt 2, death 4, special cleave 4.
- Passed: independently authored NW rear-left view, visible cape/back-strap continuity, consistent sword hand, distinct walk contacts, readable attack phases, and a terminal grounded death.
- Comparison result: the NW silhouettes express the same action intent as SE without exact mirroring or exposing contradictory front-torso details.
- Still required: `E`, `NE`, `W`, `SW` key poses, frame interpolation, transparent native-resolution cells, pivot/foot-slide validation, and runtime/browser QA.

Do not add this sheet to the production preload or release asset manifest.
