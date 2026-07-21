# TASK-020 durable recovery audit — 2026-07-21

## Verdict

**APPROVE.** The final independent Codex review and Grok CLI session `019f8303-40e9-7310-b02e-d5bb65d35b79` both reported `P0=0 P1=0 P2=0` after three review rounds. TASK-020 is limited to durable reconnect recovery; online Phaser rendering and adverse-network end-to-end coverage remain TASK-021 and TASK-022.

## Delivered contract

- The negotiated protocol is `village-siege-network/2`, with a stable logical match ID and strict `recovering`, `resumed`, and `failed` lifecycle messages.
- A disconnect creates a non-extendable 120-second half-open lease: `119999 ms` remains valid and the exact `120000 ms` boundary is expired.
- Recovery restores a verified checkpoint plus batch journal, player sequence cursors, reorder buffers, command fingerprints, and the immutable accepted/rejected result ledger.
- The client waits for a changed hello and recipient-filtered full snapshot before replaying unresolved original intents in exact `(clientCommandSeq, commandId)` order.
- Match mutations are serialized. A candidate tick, command result, frame, or winner cannot be observed before its recovery record commits; persistence failure restores the previous authority and fails closed.
- The production adapter uses PostgreSQL as the durable record and Redis for fenced routing/lease TTL. Failed Redis publication or renewal is compensated in PostgreSQL.
- Restored disconnect leases rebuild self-driving timers. A valid join cancels and persists the lease inside the mutation queue; a join at or after the exact deadline is never marked connected and executes authoritative team expiry.

## Review history

The first Codex audit rejected uncommitted-state publication, unsynchronized recovery commits, missing restored timers, incomplete restore invariants, non-sticky client failure, and stale 60-second specification text. After those were repaired, a second audit found one additional restored-seat boundary bypass in `onJoin`. The final repair moved restored joins into the mutation queue and added exact `119999/120000 ms` regression cases.

Grok CLI independently rechecked write-before-publish, mutation serialization, restored lease timers and epochs, authority restore validation, sticky client failure, and the 120-second specification. Its final boundary re-audit approved the implementation with no remaining P0, P1, or P2 findings.

## Verification evidence

- `npm run verify`: PASS
  - client: 5 files, 54 tests
  - server: 5 files, 61 tests
  - shared: 11 files, 214 tests
  - all workspace typechecks and production builds passed
- `npm run smoke:multiplayer:local`: PASS at authoritative tick 50 with exact negotiation, split rooms, private handoff, filtered delta recovery, ownership rejection, and duplicate-command idempotence.
- `npm run smoke:multiplayer:recovery:local`: PASS after a real reconnectable socket close; lifecycle was `recovering` then `resumed`, pending sequences replayed as `[0,1,2]`, authority advanced during the drop, old result ticks stayed immutable, and no duplicate resource spend occurred.
- `npm audit --audit-level=high`: PASS, zero vulnerabilities.
- `git diff --check`: PASS, no whitespace errors.

## Deferred scope

TASK-021 must render the live authoritative snapshot in `VillageAssaultScene` without local resource, training, damage, or victory commits. TASK-022 must exercise two-client and five-player-plus-AI behavior under latency, loss, malicious traffic, fog boundaries, reconnect, and final-hash comparison.
