# Village Siege art direction

## Creative thesis

The interface is an original **field ledger pinned to a limewashed village wall**. It should feel assembled by local surveyors with charcoal, river dye, pine seals, and hammered copper markers. The selector's signature is one winding river-valley route connecting three settlements; this replaces the familiar fantasy-game card wall and keeps the choice grounded in the world.

The work must not copy, trace, closely paraphrase, or recreate the layout, icon silhouettes, framing, typography, unit art, color relationships, or ornamental language of *Age of Empires II* or another commercial strategy game. The medieval setting is shared subject matter; every expression in this project must remain independently designed.

## Design tokens

| Role | Name | Hex | Use |
|---|---|---:|---|
| Field | Lime wall | `#D8D1AD` | Main selector ground and information panels |
| Structure | Pine green | `#25483C` | Seals, primary actions, friendly state |
| Route | River-valley blue | `#356B78` | Route, informational state, focus ring |
| Accent | Copper gold | `#B47A36` | Selected state and sparing emphasis |
| Ink | Charcoal | `#1C211F` | Text, borders, canvas ground |

Supporting tones are chalk `#F0EBCF`, aged lime `#AAA27D`, pale copper `#E0B866`, and warning red `#8F382F`. Copper is reserved for a current choice or one decisive action; it is not a decorative gradient.

## Type and shape

- Display: Georgia or the platform serif, heavy and tightly spaced, for chapter and settlement names.
- Body: Segoe UI / Noto Sans TC / system sans for readable Traditional Chinese text.
- Utility: Consolas / Courier New / monospace for counts, status, and small field labels.
- No external web fonts are fetched. The fallbacks are intentional and keep the build self-contained.
- Frames use uneven polygon corners, doubled rules, hard offset shadows, and stepped movement. Avoid rounded cards, glass blur, soft neon, and generic dashboard gradients.

## Composition

The selector begins with a large, two-line field-order headline. The three settlements occupy stops on one vertical water route; AI temperaments read as a compact opposing roster. At the bottom, a written expedition configuration sits opposite the single-player action and a clearly marked multiplayer placeholder.

The match HUD uses a narrow resource tally at the top, a field-note selection panel at lower left, and a stamped status strip at lower right. It should leave the center of the battlefield clear. At supported 16:9 sizes the HUD must not consume more than one quarter of the viewport.

## Pixel-handmade treatment

Production rendering favors hard edges and `image-rendering: pixelated`. Small CSS marks, offset shadows, deliberately irregular clipping, and low-detail geometry carry the hand-drawn quality without importing an image pack. When future sprites are added, silhouettes should be authored on a small grid, use two or three value groups, and be checked at native scale before smoothing is disabled.

## Interaction and accessibility

- Keyboard focus is a high-contrast chalk-and-river double ring, never a subtle color shift.
- Every selected choice shows both a copper field and explicit text such as `已選 ✓` or `敵手 ✓`.
- HUD states pair tone with a mark and message: `✓` ready, `!` warning, `×` danger, `Ⅱ` paused.
- Resource marks always have adjacent labels and values. Decorative glyphs are hidden from assistive technology.
- Live status text uses polite announcements. User- or server-provided HUD copy is written through `textContent`.
- `prefers-reduced-motion: reduce` removes stepped hover motion and any future ambient animation.
- Pointer targets are at least 44 CSS pixels high, and the responsive selector remains keyboard reachable when its AI roster scrolls horizontally.

## Originality review checklist

1. Compare against this thesis, not against screenshots of a commercial RTS.
2. Reject shield clusters, faux-gothic title treatments, bevelled stone control bars, or icon arrangements that resemble a named game.
3. Confirm each mark was drawn in-project or has an approved provenance entry.
4. Review selector and HUD at 1280×720, 1600×900, and 1920×1080, including keyboard focus and reduced motion.
5. Keep screenshots and review notes with the release evidence; do not add third-party reference imagery to the repository.
