# Six-facing turnaround review log

These images are production references for the original Village Siege combat-art pipeline. They are not runtime atlases and must not be shipped as animation frames until the direction, action, alpha, pivot, originality, and in-game gates in `docs/rework/art-bible-draft.md` pass.

## Warrior v1

- File: `warrior-six-facing-v1.png`
- Source: built-in image generation using the approved combat lineup and warrior action-sheet source as identity references.
- SHA-256: `345e0098045f8d51a812edb4b751ad373e86be897f3db99430f32ae792615ebe`
- Dimensions: `1773x887`
- Intended order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **REJECTED — revise before key-pose production**
- Blocking findings:
  - the third view reads as a direct rear view instead of a clear `NW` rear-left three-quarter;
  - the last two views are too similar to prove distinct `SW` and `SE` handedness;
  - the blade silhouette and placement drift across views;
  - the camera reads closer to a conventional character turnaround than the required elevated 2:1 isometric gameplay camera.

Do not add this candidate to the release asset manifest or production preload path.

## Warrior v2

- File: `warrior-six-facing-v2.png`
- Source: targeted built-in image-generation revision of v1, using the approved warrior action-sheet source as the locked identity reference.
- SHA-256: `685b7bd0a6803547d607f6923d9f92f48a910d785bc113f7f049b21d3eb2ae4a`
- Dimensions: `1773x887`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Direction review:
  - all six views are visually distinct and retain one consistent character identity;
  - `NE` and `NW` expose different rear shoulders, cape edges, scabbard geometry, and leg overlap;
  - `SW` and `SE` expose different front shoulders, face angles, sword-arm placement, and leg overlap;
  - the broad broken-tip blade, teal cloth zones, cape, bracer, and belt kit remain recognizable across the row;
  - no view is produced by an exact pixel mirror.
- Remaining gates: `SE` and `NW` action key poses, four additional direction key poses, native-resolution atlas cleanup, stable pivots, alpha QA, manifest validation, and browser evidence.

This approval does not authorize adding the turnaround itself to the release asset manifest or production preload path.

### Heavy crossbow v1

- File: `heavy-crossbow-six-facing-v1.png`
- SHA-256: `17f60390c9dce718a0b16f600c675f1fc5f343b7af6083793a1d9a51e725a7f1`
- Dimensions: `1774x887`
- Production method: delegated worker using the built-in `imagegen` workflow; copied into the repository for review evidence.
- Review status: **REJECTED**
- Passed: one original armored heavy-crossbow identity, stable dark teal/brown material language, readable winch crossbow, bolt quiver, and consistent equipment side.
- Blocker: the row does not prove the locked `E`, `NE`, `NW`, `W`, `SW`, `SE` order; it lacks a clear opposing side profile and over-repeats front-biased views.
- Required v2: exact six-direction order, opposing side profiles, two distinct rear diagonals and two distinct front diagonals, stable crossbow dimensions/handedness, and no exact mirroring.

### Heavy crossbow v2

- File: `heavy-crossbow-six-facing-v2.png`
- SHA-256: `a485da0e1fa09d9b2797e126adae03d5c11fc6add6c0718c7bb42a335e1bdf3d`
- Dimensions: `1774x887`
- Production method: delegated worker using the built-in `imagegen` workflow; copied into the repository for review evidence.
- Review status: **REJECTED**
- Improvement: the rear equipment, winch, crossbow limbs, armor, and bolt quiver are more stable across the row.
- Blocker: positions 1 and 4 still face the same screen side instead of proving opposing `E` and `W` profiles; positions 5 and 6 remain front-biased twins.
- Required v3: position 1 must be strict right-facing profile, position 4 strict left-facing profile; positions 2/3 must expose opposite rear shoulders, and positions 5/6 opposite front shoulders and foot projection.

### Heavy crossbow v3

- File: `heavy-crossbow-six-facing-v3.png`
- SHA-256: `f7a99cf87810074328ec469f9879507995336a9361c6f190943c4ffc7d62dfc3`
- Dimensions: `1774x887`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Production method: delegated worker using the built-in `imagegen` workflow; copied into the repository for art-direction review.
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: positions 1 and 4 establish opposing side profiles; positions 2/3 expose different rear shoulders and weapon foreshortening; positions 5/6 expose opposing face, shoulder, coat opening, foot, and crossbow geometry while preserving one original armored identity.
- Remaining gates: six-facing action key poses, bolt projectile frames, transparent native-resolution cells, pivot validation, strict no-reuse validation, manifest validation, and browser evidence.

This approval does not authorize adding the turnaround itself to the release asset manifest or production preload path.

### Mage v5

- File: `mage-six-facing-v5.png`
- SHA-256: `976088b79489560ffe46b7e7f8a570b24f00a99cb3dffaecb278d341e8ba0cf6`
- Dimensions: `2167x726`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: the final two views now separate their chest opening, face angle, near shoulder, robe fall, and leading foot toward opposite front diagonals; all six retain one ring staff, hand, hood tail, belt kit, and body identity without exact mirroring.
- Remaining gates: six-facing action key poses, arcane projectile frames, transparent native-resolution cells, pivot validation, manifest validation, and browser evidence.

### Shield-bearer v5

- File: `shield-bearer-six-facing-v5.png`
- SHA-256: `5ae01b4302d18a7643a355a7ddf11a967a1d621357c9e685a9a36e051ebf4cd5`
- Dimensions: `2172x724`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: the last two views now use opposing head, torso, foot, spear, and shield-edge foreshortening; all six preserve one shield/spear hand, rear straps, coat quilting, belt kit, and character identity without exact mirroring.
- Remaining gates: six-facing action key poses, transparent native-resolution cells, pivot validation, manifest validation, and browser evidence.

### Boar rider v1

- File: `boar-rider-six-facing-v1.png`
- SHA-256: `f502bc6cb760b36111dfb964ca70a74085f87a0a6a965419a447ca0907a1c57c`
- Dimensions: `2117x743`
- Review status: **REJECTED**
- Passed: the six camera directions, boar proportions, rider identity, teal saddle cloth, and opposing head/tusk foreshortening are readable.
- Blocker: the generated round back shield is outside the locked silhouette, the short hooked lance drifted into a conventional long spear, and the unequal tusks are not consistent across all six views.

### Boar rider v2

- File: `boar-rider-six-facing-v2.png`
- SHA-256: `a4e7ec3b649c8c6bdd4050a071573f6efc4035933cde123016c6a90e6683e614`
- Dimensions: `2117x743`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: the out-of-scope shield is removed; all six views retain one short hooked lance, one physical weapon hand, a low long boar, forward rider, teal saddle cloth, asymmetrical tusks, and distinct opposing profile/rear/front geometry without exact mirroring.
- Remaining gates: six-facing mounted action key poses, rider/boar separation death, transparent native-resolution cells, pivot validation, manifest validation, and browser evidence.

This approval does not authorize adding the turnaround itself to the release asset manifest or production preload path.

## Parallel P2 candidates — first-pass rejection

These candidates were produced independently by delegated workers and retained as audit evidence. All three are **REJECTED** and may not enter key-pose or runtime production.

| Candidate | Dimensions | SHA-256 | Blocking review finding |
| --- | ---: | --- | --- |
| `archer-six-facing-v1.png` | 1983x793 | `2bc2df5ba1ab97e8913a3f4bb1493899460e12bed4d63014f23023be791a9faf` | E/NE read too similarly; the row does not prove the exact required direction order. |
| `mage-six-facing-v1.png` | 2172x724 | `9a84f922c70774414a0646cfd740046988e3199a499232c7fddcd96b62242928` | Several views are front-biased; rear-left/rear-right and side profiles are not unambiguous. |
| `shield-bearer-six-facing-v1.png` | 2172x724 | `c4ec32bcd60e7246edf2f7fe89b0ef8deeb3c8fdc99af09017001e51cd910380` | Side/front views repeat and the shield/spear geometry does not prove six independent ordered facings. |

Required revision for every v2: exact left-to-right `E`, `NE`, `NW`, `W`, `SW`, `SE`; one shared elevated 2:1 isometric camera; distinct shoulder, face, leg-overlap and rear-gear evidence; stable weapon dimensions and handedness; no exact mirror.

### Mage v2

- File: `mage-six-facing-v2.png`
- SHA-256: `1227458357fed483c27067ebce5df2527848568e2901c3c419c54d8da5e38953`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: rear robe, hood tail, back straps, and ring staff are more consistent than v1.
- Blocker: positions 1 and 4 face the same side rather than proving opposite `E`/`W` profiles; positions 5 and 6 remain too similar to prove distinct `SW`/`SE`.

### Shield-bearer v2

- File: `shield-bearer-six-facing-v2.png`
- SHA-256: `18e42abb20cea0374047060ff89489979ae437cb8645fd7617459717ea932a5c`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: shield diameter, wicker face, rear straps, coat quilting, and short-spear materials are more consistent than v1.
- Blocker: positions 1 and 4 still face the same side rather than proving opposite `E`/`W` profiles; positions 5 and 6 remain front-biased and too similar.

### Archer v2

- File: `archer-six-facing-v2.png`
- SHA-256: `4cf1a11cef6a985f41ce5f3f5dbf1090a91768c1846f085e4b93585aedf7dec1`
- Dimensions: `1981x793`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: the opposing side profiles, two rear diagonals, and two front diagonals expose distinct face, shoulder, cloak, bow, quiver, and leg-overlap evidence; the same bow hand and equipment side are retained without exact mirroring.
- Remaining gates: six-facing action key poses, transparent native-resolution cells, projectile frames, pivot validation, manifest validation, and browser evidence.

This approval does not authorize adding the turnaround itself to the release asset manifest or production preload path.

### Mage v3

- File: `mage-six-facing-v3.png`
- SHA-256: `3cde4c289b26acfabb3997353736f4b0562ee44bd2ceb0e6fe5402aa8ab32801`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: positions 1 and 4 now establish opposite profiles, and the two rear diagonals preserve the hood tail, robe seams, belt kit, and ring-staff hand.
- Blocker: positions 5 and 6 remain nearly frontal twins rather than unambiguous opposing `SW` and `SE` views; face angle, shoulder overlap, foot projection, and robe opening do not yet prove opposite camera diagonals.

### Shield-bearer v3

- File: `shield-bearer-six-facing-v3.png`
- SHA-256: `7cfe37fd3f67fce5dc31656ac6e22e95f18729e4153eef8566ca0bae0f3eb2b2`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: positions 1 and 4 now establish opposite profiles; the two rear diagonals retain shield straps, spear hand, quilted coat, and belt kit.
- Blocker: positions 5 and 6 are almost the same frontal pose; shield foreshortening, face direction, leading shoulder, and foot overlap do not prove distinct `SW` and `SE` views.

### Mage v4

- File: `mage-six-facing-v4.png`
- SHA-256: `9d89aea93499cea261bb73ed829441ca8fac3a0d61753d316454459ea8a53ae7`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: all six figures preserve one identity, staff hand, robe layout, and opposing profile/rear geometry.
- Blocker: positions 5 and 6 still turn the face, chest opening, and leading foot toward substantially the same screen side, so they do not prove opposite `SW` and `SE` camera diagonals.

### Shield-bearer v4

- File: `shield-bearer-six-facing-v4.png`
- SHA-256: `0b9c4cb3fbbb72618152d5e2767e2851c2351209c2bd44130e7318a03e101d66`
- Dimensions: `2172x724`
- Review status: **REJECTED**
- Improvement: shield dimensions, spear hand, opposing profiles, and rear strap geometry are stable.
- Blocker: positions 5 and 6 still read as frontal variants looking toward the same screen side; the shield edge, nose, chest, and leading foot do not form clearly opposite `SW` and `SE` views.

### Musketeer v1

- File: `musketeer-six-facing-v1.png`
- SHA-256: `6e18e0226df6154a579e773ac6eebdee9a70b49d73c5839069881b8d845a54e4`
- Dimensions: `1774x887`
- Direction order: `E`, `NE`, `NW`, `W`, `SW`, `SE`
- Review status: **APPROVED FOR KEY-POSE PRODUCTION ONLY**
- Passed: opposing side profiles and rear diagonals are unambiguous; the final two figures show different front shoulders, face angles, coat openings, foot projections, and musket foreshortening while preserving one physical firing hand and equipment side.
- Remaining gates: six-facing action key poses, muzzle/trace projectile frames, transparent native-resolution cells, pivot validation, manifest validation, and browser evidence.

This approval does not authorize adding the turnaround itself to the release asset manifest or production preload path.

### Miremaw v1

- File: `miremaw-six-facing-v1.png`
- SHA-256: `cba87e9023ed2847b7dc783242e88c447fe9da616f0df12cb0f86529cac4b4a8`
- Dimensions: `2172x724`
- Production method: delegated worker using the built-in `imagegen` workflow; copied into the repository for review evidence.
- Review status: **REJECTED**
- Passed: a strong original low-slung swamp predator silhouette, stable broad jaw, mud-plate shell, reed cluster, four-foot anatomy, and clearly opposing side/rear/front geometry.
- Blocker: the panels are visually ordered `W`, `NW`, `NE`, `E`, `SE`, `SW`, which reverses the locked production contract `E`, `NE`, `NW`, `W`, `SW`, `SE`.
- Required v2: retain the exact creature identity and materials while swapping the direction order so position 1 faces screen-right and position 4 faces screen-left; rear and front diagonals must follow the locked order without mirroring.
