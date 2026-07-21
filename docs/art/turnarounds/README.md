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
