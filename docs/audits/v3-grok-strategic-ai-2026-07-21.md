# Village Siege v0.11 strategic AI — Codex + Grok final audit

- Date: 2026-07-21
- Scope: `TASK-014` only
- Implementation owner: Codex
- Independent reviewer: Grok CLI, read-only session `019f8103-8ab0-7bb1-b701-a11cf8d1789c`

## Verdict

**PASS for TASK-014.** Grok returned `APPROVE` with no P0 or P1 findings. This decision completes the strategic-AI slice; it does not declare the full RTS v3 plan complete. Victory policy, versioned saves and command-journal replay remain `TASK-015` and `TASK-016`.

## Delivered authority contract

- AI seed, cadence, fog-authorized enemy memory, counter lock, repair target, strategic phase, regroup point, active wave, cooldown and telemetry are canonical `MatchState` data.
- `reduceAi` is a fixed-work pure reducer. Runtime commands use the normal player sequence and shared validator.
- Reduced planner state is committed only after an emitted command succeeds, or for a commandless phase transition.
- Human snapshots exclude AI private authority. Tactical signals expose only a coarse cue anchored to a currently visible hostile entity.
- Pinehold, Riverstead and Highcrag use layout-aware walk, placement and occupancy models. Open gates and rubble are walkable while still blocking construction placement.
- Empty-handed gathering workers may be rebalanced for an explicit resource target; hauling, construction and repair work are not interrupted.

## Verification evidence

- `npm run typecheck`: PASS for client, server and shared workspaces.
- `npm test`: PASS. Client runtime integration 5/5; shared deterministic suites 174/174.
- `npm run build`: PASS. Vite reports a non-blocking large-chunk warning.
- `npm run smoke:multiplayer:local`: PASS for two-player room creation, host/readiness guards, invalid payload rejection, reconnect and authoritative tick.
- Strategic long run: five profiles, up to 18,000 ticks each, zero rejected self-issued commands, successful economy progression or conquest, and five distinct telemetry signatures.
- Fortified legality matrix: three authored layouts by five profiles for 1,500 ticks, zero rejected commands and non-zero activity in every case.

## Grok findings and disposition

Grok reported seven P2 observations and no blocking findings.

1. Grok did not itself rerun the reported gates. Codex reran and recorded them above.
2. Client runtime tests were not part of root `npm test`. A client `test` script and explicit Vitest dependency now make the five cases part of the workspace gate.
3. Command-journal replay does not yet orchestrate AI reducers. This remains the explicit scope of `TASK-016`; canonical snapshots and hashes already include planner state.
4. Planner authority could advance before a rejected command. Runtime commit ordering was changed so rejected commands cannot advance planner state.
5. Several counter, retreat and wave edge cases use synthetic observations. The suite also retains full 18,000-tick personality runs and the 15-case fortified matrix.
6. Compact HUD crowding is inferred from the existing notice path rather than a dedicated layout test. No command-dock control was added; responsive browser evidence remains a later release-gate item.
7. New files were untracked during audit. They are included in the TASK-014 commit gate.

Grok's post-remediation amendment retained `APPROVE` with P0 and P1 both `none`. The amendment did not independently rerun Codex's gates, so the command results above remain Codex-owned verification evidence.

## Originality boundary

The implementation uses Village Siege identifiers, rules and authored map topology. It does not copy Age of Empires names, art, sound, balance tables or numeric data. The comparison is limited to the genre-level RTS loop.
