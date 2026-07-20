# Village Siege v0.7.0 Grok tactical-combat audit

Date: 2026-07-20

Branch: `codex/rts-complete-v3`

Mode: Grok CLI read-only repository review. Codex remained implementation owner; Grok was instructed not to edit, create, delete, stage, commit, push, deploy or install anything.

## Verdict

Grok returned **APPROVE** for the v0.7.0 tactical-combat slice.

- P0 blockers: none.
- P1 blockers: none.
- The canonical villager plus seven combat roles, team-hostile targeting, counter relationships, deterministic passive rules, attack phases, tactical commands, projectile rules, AI legality and fixed seven-slot mobile controls are covered by source and tests.
- The implementation remains an original Village Siege design released under MIT. It does not copy another game's names, artwork, audio, interface composition, maps, source code or proprietary balance table.

“Private design” means an original Village Siege brand, world, mechanics expression, art direction and balance. It does **not** mean closed source: client, server, shared simulation, reusable art sources and self-hosting/deployment material remain fully MIT open. Secrets and live credentials are the only material excluded from version control.

## Evidence checked

- `npm run verify`: client, server and shared typechecks passed; 125 shared tests passed; client and server production builds passed.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run smoke:multiplayer:local`: lobby ownership, readiness validation, invalid-payload rejection, reconnect and authoritative lobby tick checks passed.
- Codex Playwright QA, reviewed as supporting evidence: no overflow or console errors at 568x320, 667x375, 844x390 and 1280x720; exactly seven visible contextual controls at every size.
- Shared combat checks include entrants into active ground effects, line-projectile per-tick traversal, terrain and building obstruction, target hit caps, deterministic public projectile position, passive progress and a repeated 10,000-tick determinism run.

## Non-blocking findings and disposition

1. README still described repair as unfinished. Corrected in this slice.
2. README still described all large-unit formations as unfinished. Corrected to document the implemented line, wedge and square slot formations while retaining the dynamic-avoidance limitation.
3. README omitted tactical targeting from the `Esc` cancellation order. Corrected in this slice.
4. One test variable retained the old `militiaBefore` name after the unit became `warrior`. Renamed in this slice.
5. Older unused client demo content remains a later cleanup candidate because removing it is outside this combat slice.

## Multiplayer claim boundary

The current online code is still only a lobby/reconnect/tick prototype. This release cannot claim authoritative online battle simulation, production matchmaking, a public secure WebSocket service, reconnectable live battles, anti-cheat enforcement or completed multiplayer. Those require the later server-authoritative multiplayer work before public promotion.

Grok made no repository changes.
