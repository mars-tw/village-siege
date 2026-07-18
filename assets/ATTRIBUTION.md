# Asset attribution

Village Siege ships original project artwork and programmatic UI marks. The combat portrait source was generated specifically for this project with OpenAI image generation, selected by the project owner, and then processed locally; it is not copied or traced from a commercial game. Unicode characters are text, not bundled font assets.

| Asset or presentation source | Kind | Author / source | License | Provenance note |
|---|---|---|---|---|
| `apps/client/src/style.css` | Original UI styling and procedural marks | Village Siege contributors | MIT | Authored for this repository; no traced or imported game UI |
| `apps/client/src/ui/hud.ts` | Original HUD structure | Village Siege contributors | MIT | HTML is generated locally; no external icons or images |
| `apps/client/src/scenes/VillageSelectScene.ts` | Original selector structure and copy | Village Siege contributors | MIT | Village and AI marks use plain Unicode text with visible labels |
| `apps/client/public/assets/original/source/combat-lineup-approved.png` | Approved seven-unit source master | Village Siege project owner / OpenAI image generation | MIT project asset | Project-bound generation selected by the project owner; SHA-256 and dimensions are recorded in `asset-metadata.json` |
| `apps/client/public/assets/original/source/combat-lineup-approved-alpha.png` | Reproducible transparent crop master | Village Siege contributors | MIT project asset | Derived only from the approved source with the installed imagegen chroma-removal helper; no subject was regenerated |
| `apps/client/public/assets/original/units/*/portrait.png` | Seven transparent combat portraits | Village Siege contributors | MIT project asset | Cropped from the approved alpha master; edge fragments removed, small enclosed alpha damage repaired from the source master, and 16 px transparent padding added by `scripts/extract-combat-portraits.mjs` |
| `apps/client/public/assets/original/source/monster-lineup-approved.png` | Original three-monster source master | Village Siege project owner / OpenAI image generation | MIT project asset | Generated for this project on a flat magenta key background; contains miremaw, ashwing, and rootback only |
| `apps/client/public/assets/original/source/monster-lineup-approved-alpha.png` | Transparent three-monster crop master | Village Siege contributors | MIT project asset | Derived with the installed imagegen chroma-removal helper; no subject was regenerated |
| `apps/client/public/assets/original/monsters/*/portrait.png` | Three transparent monster portraits | Village Siege contributors | MIT project asset | Reproducibly cropped with 16 px transparent padding by `scripts/extract-monster-portraits.ps1`; hashes and crop boxes are recorded in `monster-asset-metadata.json` |
| `apps/client/public/assets/original/units/*/sprites/action-sheet-source.png` | Seven original 24-frame unit action masters | Village Siege project owner / OpenAI image generation | MIT project asset | Generated specifically for this project from each approved portrait identity reference on a flat magenta key; exact 4 columns × 6 action rows |
| `apps/client/public/assets/original/units/*/sprites/action-sheet.png` | Seven transparent unit action sheets | Village Siege contributors | MIT project asset | Chroma removed locally with the installed imagegen helper; contains authored idle, walk, attack, cast, hurt, and death poses |
| `apps/client/public/assets/original/monsters/*/sprites/action-sheet-source.png` | Three original 24-frame monster action masters | Village Siege project owner / OpenAI image generation | MIT project asset | Generated specifically for this project from each approved monster identity reference on a flat magenta key |
| `apps/client/public/assets/original/monsters/*/sprites/action-sheet.png` | Three transparent monster action sheets | Village Siege contributors | MIT project asset | Chroma removed locally with the installed imagegen helper; no commercial game art was copied or traced |

## Local asset tooling

`scripts/extract-combat-portraits.mjs` uses `sharp` 0.32.6 (Apache-2.0) as a local build-time crop and pixel-inspection tool. The prepared alpha master was produced with the installed imagegen skill helper at `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`. Neither tool nor its dependencies are bundled into the browser runtime. Exact crops, hashes, alpha statistics, cleanup counts, and tool versions are recorded in `apps/client/public/assets/original/asset-metadata.json`.

## Adding assets

Every future shipped asset must add one row before merge with its exact repository path, creator/source URL, license identifier, and modification notes. Allowed third-party licenses are MIT, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0, CC-BY-4.0, and Apache-2.0; CC-BY-4.0 material must include the creator, title, source, license link, and changes. Unknown provenance is release-blocking.
