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

## Warrior E v1

- File: `warrior-e-v1.png`
- Reference: approved warrior turnaround, approved SE action rhythm, and the approved warrior action-sheet source.
- SHA-256: `5739d6b744f807952f0f1cde31cd19d5a1450546a3b97f83d37b086e76a22caf`
- Dimensions: `1024x1536`
- Review status: **APPROVED FOR DIRECTION-SET CONTINUATION**
- Pose inventory: idle 2, walk 4, attack 4, hurt 2, death 4, special cleave 4.
- Passed: independent E right profile, stable sword hand and blade silhouette, readable four-stage walk/attack/death/cleave sequences, and no exact reuse of the SE or NW silhouettes.
- Still required: `NE`, `W`, `SW` key poses, frame interpolation, transparent native-resolution cells, pivot/foot-slide validation, and runtime/browser QA.

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

## Warrior W v1

- File: `warrior-w-v1.png`
- Reference: approved warrior turnaround, approved E action rhythm, and the approved warrior action-sheet source.
- SHA-256: `578eebae684f42a733d631aebdaebe34996a1da0a93c56b89a36a19ccfcf303a`
- Dimensions: `1024x1536`
- Review status: **APPROVED FOR DIRECTION-SET CONTINUATION**
- Pose inventory: idle 2, walk 4, attack 4, hurt 2, death 4, special cleave 4.
- Passed: independently authored W left profile, E/W asymmetric cape and gear silhouettes remain distinguishable, the sword stays in the same physical hand, and all actions keep a stable side-view root.
- Still required: `NE` and `SW` key poses, frame interpolation, transparent native-resolution cells, pivot/foot-slide validation, and runtime/browser QA.

Do not add this sheet to the production preload or release asset manifest.

## Warrior NE v1

- File: `warrior-ne-v1.png`
- Reference: approved warrior turnaround plus the approved SE, NW, E, and W action rhythm.
- SHA-256: `92f6922c6f9cf962500a5e6bf4eff424936fc466a56e50912c4314f213cd945e`
- Dimensions: `1024x1536`
- Review status: **APPROVED FOR DIRECTION-SET CONTINUATION**
- Pose inventory: idle 4, walk 4, attack 4, hurt 4, death 4, special cleave 4.
- Passed: independently authored NE rear-right three-quarter view, stable sword hand and cape/back silhouette, distinct walk contacts, chronological attack and hurt recoveries, a terminal grounded death, and a restrained readable cleave effect.
- Still required: `SW` key poses, transparent native-resolution cell extraction, pivot/foot-slide validation, and runtime/browser QA.

Do not add this sheet to the production preload or release asset manifest.
