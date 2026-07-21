# Village Siege v0.12 victory authority — Codex + Grok final audit

- Date: 2026-07-21
- Scope: `TASK-015` only
- Implementation owner: Codex
- Independent reviewer: Grok CLI, read-only session `019f813a-51c3-70c0-932e-1f8efeff8d6a`

## Verdict

**PASS for TASK-015.** Grok returned `APPROVE` with no P0 or P1 findings. Three independent Codex audit lines also approved shared determinism, mobile/static presentation and task-boundary documentation after their P1 findings were remediated.

This decision completes the deterministic victory-policy slice. It does not declare the full RTS v3 plan complete: versioned saves and command-journal replay remain `TASK-016`; the tutorial remains `TASK-017`; full server-authoritative battlefield multiplayer remains `TASK-018` through `TASK-022`.

## Delivered authority contract

- Canonical match state and safe visible snapshots contain the complete victory policy, sorted team progress, controller state, outcome, winners, causal reason, all same-tick triggers and finish tick.
- Conquest uses a completed-command-center rebuild grace; elimination ignores orphan sites, walls, gates, rubble and projectiles; completed Copper Landmarks require a continuous hold; central control scores exactly once per uncontested fixed tick.
- A command batch is applied before one victory resolution. Same-tick opposing surrenders and different-team objectives produce explicit draws rather than input-order winners.
- Surrendered or eliminated assets cannot move, attack, produce, occupy the objective or leave owned projectiles active while an ally continues.
- Terminal result emits once, locks later commands, remains available after missed events, and participates in canonical hashing.
- The playable local runtime enables all four original routes. Desktop and 568×320 landscape layouts keep progress and final result in the fixed HUD, retain only the existing replay/return actions, announce one assertive result and focus the replay action.

## Verification evidence

- `npm run verify`: PASS.
  - Client: 15 tests passed.
  - Shared: 9 files and 187 tests passed, including a 10,000-tick chunking/hash equality case.
  - Client and server production builds passed.
  - Vite emitted only the existing non-blocking large-chunk warning.
- `git diff --check`: PASS.
- Playwright CLI real-browser checks:
  - 568×320 landscape HUD: no overlap; two-line victory progress remains inside the fixed top bar.
  - 1280×720 desktop HUD: no overlap.
  - Browser console: 0 errors and 0 warnings.
- Grok CLI `0.2.106 (bde89716f6)`, model `grok-4.5`, tools restricted to `Read,Glob,Grep`, web disabled, memory disabled and subagents disabled.

## Grok findings

Grok found no P0 or P1. Its three non-blocking P2 observations were:

1. The shared/runtime surrender command has no player-facing local HUD action. It remains available for authoritative rules, disconnect handling and future online flows; adding another action to the fixed seven-slot dock requires a separate mobile interaction decision.
2. The beginner guide did not yet explain all four routes. The guide now documents exact conquest, elimination, landmark and central-control behavior plus same-tick draws.
3. The plan row was not yet checked. `TASK-015` is now marked complete after the audit gate.

## Originality and online boundary

The implementation uses Village Siege identifiers, original rules and shared authored geometry. It does not copy Age of Empires names, art, sound, balance tables or numeric data. Genre-level inspirations do not grant permission to copy protected expression.

The current Colyseus room still owns only lobby state and a server-owned lobby clock. It does not yet run the shared battlefield simulation, so this audit does not describe current multiplayer combat as authoritative or fully playable.
