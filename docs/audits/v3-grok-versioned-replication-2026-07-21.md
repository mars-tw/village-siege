# TASK-019 versioned replication audit — 2026-07-21

## Verdict

**APPROVE for TASK-019.** Grok CLI sessions `019f826f-bb74-7c02-ba16-a335b8296562` and `019f829d-2c96-7571-987f-e0e866c2972b` ended at `P0=0 P1=0 P2=0`. The final independent Codex authority audit also reported `P0=0 P1=0 P2=0` after running the real two-client smoke path. Durable reconnect replay remains explicitly assigned to TASK-020.

## Replication boundary delivered

- Lobby admission and match hello require the exact network protocol and gameplay rules tuple before a private seat can start play.
- The browser submits only versioned command intents. Match and player identity remain server-injected, while bounded command ordering, immutable result replay, backpressure and exact retry protect authoritative mutation.
- Each recipient receives only a fog-filtered full snapshot or an atomic keyed delta at 10 Hz. Full snapshots recur every 50 ticks; canonical hashes remain server-private every 20 ticks.
- Visible checksums, strict nested wire guards and same-tick divergence detection prevent partial or malformed state from entering the client store. A failed chain freezes delta application until a valid full snapshot recovers it.
- Delayed lobby and match promises are lifecycle-cancelled, terminal command transitions consume a strictly newer authoritative tick, and all correlatable command outcomes use the dedicated `match.commandResult` channel.
- Lobby and match rooms enforce payload and per-client message-rate limits. Seed, canonical state, hidden entities, AI planner state and production queues are not serialized to clients.

## Verification evidence

- `npm run verify`: exit 0.
  - client: 38/38 tests
  - server: 18/18 tests
  - shared: 212/212 tests
  - client, server and shared typechecks passed
  - client, server and shared production builds passed
  - Vite retained only the existing advisory for a JavaScript chunk larger than 500 kB
- `npm run smoke:multiplayer:local`: passed with two real SDK clients through tick 50.
  - exact version negotiation and isolated lobby/match rooms
  - private seat handoff and unreserved-seat rejection
  - filtered delta chain, deliberate gap detection and full-snapshot recovery
  - per-player acknowledgement isolation
  - forged ownership rejected as `ENTITY_NOT_OWNED`
  - injected authority fields rejected as `INVALID_PAYLOAD`
  - a duplicate training intent deducted exactly 50 food once
  - canonical state and private seed absent from serialized frames
- `npm audit --omit=dev`: zero known production vulnerabilities.
- Port 26567 was free after the smoke run.

## Remaining gate

TASK-020 must add durable reconnect recovery and automatically resend unresolved intents in sequence after a recovered full snapshot. TASK-019 intentionally proves versioned authority, filtered replication, idempotence and resynchronization without claiming that later recovery, online rendering or adverse-network E2E gates are complete.
