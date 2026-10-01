# R25 final source review

Reviewed the final R25 working tree targeting application `1.1.0` with a bounded read-only source pass after the three playtest lanes completed. This reviewer did not edit source, rerun the full suite, publish, deploy, or push.

## Conclusion

No open source-review finding remains in the narrow final scope.

The new battle-mode path is internally consistent: new games default to `siege`, the tutorial stays on `territory`, territory retains the four existing victory routes, and siege keeps only command-center conquest plus elimination. Continue, imported-save, imported-replay, retry, and restart paths synchronize or preserve the active policy instead of replacing a validated archive with the menu default. The battle-mode helper returns fresh nested policy objects, so one match cannot mutate another match's preset.

The final native canvas-button guard was also reviewed. When a pointer-up originates from a button's own accessibility DOM element, its native click owns the action and Phaser does not execute the same action a second time. The desktop player lane reproduced the pre-fix failure as one role click changing the barracks queue from `0/5` to `2/5`; after a manual no-HMR reload, the same flow produced `0→1`, while two separate clicks produced `0→1→2`.

## Autosave restore option

The new autosave write option is narrowly scoped and keeps the normal stale-write guard:

- `AutoSaveWriteOptions.restore` defaults to absent/false. A same-match write older than `latest.tick` is still rejected in the ordinary timer, finish, page-hide, leave-battle, and forced-save paths.
- `saveAutomaticBattle(true, true)` appears only in `applyImportedArchive`, after an imported save or replay has passed isolated runtime validation and replaced the live runtime.
- The explicit restore write makes the imported checkpoint `latest` and preserves the newer checkpoint as `previous`, so the user can continue from the imported archive without erasing the more recent recovery point.
- The focused autosave regression covers invalid restore bytes leaving storage unchanged, an intentional older restore preserving the newer backup, a subsequent normal continuation, and rejection of a later stale ordinary write.

This resolves the observed browser flow where a valid manually imported checkpoint was restored but the normal older-tick protection initially prevented it from becoming the current autosave. The exception is attached to the archive-restore boundary rather than weakening autosave globally.

## Actual play and visual acceptance

R25 used three actual browser-play lanes: desktop newcomer, strategy/visual, and touch. They were independent contexts in the same Codex model family, not different-model or human research. Their reports distinguish direct observation from inference and do not present AI preference scores as player-survey results.

- Desktop newcomer baseline reached a real defeat at 581 seconds. The modified build then ran past eight minutes, exercised both battle-mode selectors, individual worker assignments, near-town-center construction, building management, production, age advancement, attack/complete feedback, save export, manual reload, and UI save import.
- The final desktop mode buttons measured about `226.4×44 CSS px`; the worker-management button measured `96×48 CSS px`. The 1280×720 menu remained fully available without scrolling.
- The visual and touch final checks were reported passed by their owner lanes. Their evidence remains in the corresponding R25 playtest reports and `docs/evidence/r25` artifacts.

## Root verification record

The root verification lane reports the final integrated tree passing 526 tests: 157 client, 86 server, 262 shared, and 21 ops. It also reports typecheck, production build, directional-art validation `87/87`, runtime compliance over `9,934,552` bytes, and a production audit with zero reported vulnerabilities. These results are recorded here as root-provided execution evidence; this narrow reviewer did not rerun them.

## Honest scope boundary

R25 materially improves worker control, construction feedback, battle alerts, menu clarity, unit scale, touch access, and the ability to choose a longer conquest-focused match. The shoreline still has a visible grid/tile character. A complete *Age of Empires III*-level 3D environment, animation/content scale, logistics, and supply system remain outside this release. Those are honest product-scope gaps, not regressions or release blockers for this original browser RTS.
