# TASK-018 authoritative match audit — 2026-07-21

## Verdict

**APPROVE for TASK-018.** Grok CLI session `019f8234-8e07-7fb1-9b2f-8cf1f35e7551` reported `P0=0 P1=0 P2=0` after three initial P2 findings were corrected and re-audited. The implementation establishes the server-authoritative battlefield slice only; protocol negotiation and deltas, durable recovery, online Phaser rendering, and complete multiplayer E2E remain TASK-019 through TASK-022.

## Authority boundary delivered

- `village_siege_lobby` owns only the room code, roster, ready state and handoff. It launches a separate private `village_siege_match` through a single-use process-private capability.
- Each human receives a stable gameplay player ID and its own pre-reserved Colyseus seat. Distinct 32-byte internal tokens stay inside the server reservation path; the browser cannot choose the authoritative match ID, player ID, team ID or seed, and the complete reservation set locks the room against seat theft.
- `MatchAuthority` owns the complete shared `MatchState` and advances it once every `TICK_MILLISECONDS = 100`. Its public surface returns only per-recipient `VisibleSnapshot`, projected events and the owner's command results.
- The Colyseus match schema exposes only match ID, public phase and server tick. It never serializes canonical players, hidden entities, production queues, AI authority or random state.
- Incoming commands are strict `{ sequence, clientTick, command }` intents. Shape, membership, phase, monotonic received sequence and a 16-command per-player next-tick bound are checked before batching; shared simulation performs semantic validation and mutation in deterministic player/sequence order.
- Same numeric sequences from different players are routed independently. A queued sequence remains consumed even if an earlier command in that tick makes it fail semantic validation.
- A match that does not receive every assigned player closes after 30 seconds. Clients still stranded in the lobby recover after 35 seconds: the lobby unlocks, clears ready state and emits `MATCH_HANDOFF_EXPIRED`.

## Verification evidence

- `npm run verify`: passed.
  - client: 26/26 tests
  - server: 9/9 tests
  - shared: 205/205 tests
  - client, server and shared typechecks passed
  - client, server and shared production builds passed
  - Vite retained only the existing advisory for a JavaScript chunk larger than 500 kB
- `npm run smoke:multiplayer:local`: passed with two real SDK clients.
  - public match creation without a launch capability rejected with the exact expected Colyseus full-room response
  - lobby room ID and match room ID differed
  - both clients consumed separate private seats in the same match
  - an unreserved client was rejected because the fully reserved authoritative match was locked
  - recipient IDs and fog-filtered frames differed without canonical-state serialization
  - both players used sequence zero and each received exactly its own acknowledgement
  - forged ownership returned `ENTITY_NOT_OWNED`
  - injected `playerId` returned `INVALID_PAYLOAD`
  - accepted villager training deducted 50 authoritative food
- `npm audit --omit=dev`: zero known production vulnerabilities at the TASK-018 gate.

## Remaining gates

TASK-018 does not declare multiplayer playable. The lobby currently proves the server handoff and displays authoritative ticks, but `VillageAssaultScene` remains the single-player renderer. TASK-019 must add version negotiation, command IDs/deduplication and delta/hash cadence; TASK-020 must add the 120-second durable recovery contract; TASK-021 must render online snapshots without local authority; TASK-022 must prove complete two-client and five-faction/AI behavior under latency, loss, reconnect and malicious traffic.
