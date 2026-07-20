# Village Siege v3 authoritative RTS architecture

Date: 2026-07-20

Status: planned; v2 multiplayer remains a lobby and command-acknowledgement prototype.

## Product boundary

Village Siege implements original classic-RTS systems. It does not copy Age of Empires artwork, audio, factions, names, maps, interface composition, campaigns, source code or proprietary balance tables. “Private design” means Village Siege owns its brand and original expression; it does not mean closed source. Client, server, shared rules, art sources and deployment templates remain MIT licensed and self-hostable. Only live credentials and private keys stay outside version control.

## Authority model

```text
Browser client
  - selection, camera, local previews and animation
  - submits versioned command intents
  - renders/interpolates filtered server state
                 |
                 | TLS WebSocket
                 v
Colyseus gateway
  - LobbyRoom: roster, village, AI slots, readiness
  - AuthoritativeMatchRoom: fixed simulation and validation
                 |
                 +-- Redis: room lease and reconnect session
                 +-- PostgreSQL: checkpoints and command journal
```

The browser never commits resources, damage, training, research, visibility or victory during an online match. `packages/shared` contains deterministic rules used by the server and offline mode. The online client may predict cursors, route previews and presentation timing only.

## Versioned command envelope

Every online intent shall include:

```ts
interface OnlineCommandEnvelope {
  protocolVersion: string;
  rulesVersion: string;
  matchId: string;
  playerId: string;
  commandId: string;
  clientCommandSeq: number;
  lastServerTickSeen: number;
  command: GameCommand;
}
```

The server rejects unsupported protocol or rules versions before joining a match. `commandId` and `clientCommandSeq` provide idempotence and total ordering per player. A retry of the same command cannot spend resources or enqueue work twice.

## Simulation and replication

- Server simulation target: fixed 20 Hz after the authoritative-room migration.
- Filtered state deltas: 10 Hz.
- Full player-filtered snapshot: every 5 seconds and on reconnect.
- Canonical state hash: every 2 seconds.
- Reconnect lease: 120 seconds.
- Determinism: integer or fixed-point values, seeded random state, stable entity IDs and explicit sorted iteration.
- Hash mismatch: stop delta application and request a full server snapshot; never accept a client state upload as truth.

Snapshots include player/team state, resources, population, settlement tier, research, visibility, entities, orders, queues, projectiles, AI seed/state, victory state, server tick and PRNG state. Fog filtering occurs before serialization, so hidden live enemy data never reaches the browser.

## Technology research contract

Version `village-siege/0.5.0` defines seven original technologies in shared content. A `research` command names the producing building and technology; the server or offline shared simulation validates ownership, building completion and survival, settlement tier, prerequisite technologies, player-global duplicate state, resources and the five-slot queue limit before charging once. Pending or completed duplicates return the explicit `DUPLICATE_RESEARCH` rejection instead of being conflated with a missing prerequisite.

Training and research share one FIFO production lane per building. Production is lost without refund if the building is destroyed. A completed technology emits `technologyResearched`, enters the player's canonical sorted completion list and affects actions beginning on the following simulation tick. Economy, attack, maximum hit points, unit speed and building durability are computed through pure derived-stat functions so current entities, future entities, AI, replay and canonical hashes use the same values.

The fixed seven-slot client dock is presentation only. It may show locked reasons, queue position, progress and completion notices, but it never grants a technology locally. AI personalities submit the same command and use distinct deterministic priority lists and research intervals.

## Server validation

Every command validates membership, ownership, entity life, resource balance, population, settlement tier, research, cooldown, visibility, diplomacy, range, footprint, terrain, route, rate limit, payload size and sequence. Client timestamps, positions, damage, resources and completion times are untrusted.

## Recovery

There is no player-host migration because no browser is authoritative. Initial production may end a match explicitly if its server instance fails. The recovery milestone stores a compressed snapshot every 2 seconds and a short command journal; a replacement instance must acquire the Redis room lease, restore the snapshot, replay the journal and accept reconnects within 15 seconds.

## Fully open deployment

The public `village-siege` repository includes:

- MIT client, server and shared simulation.
- Dockerfiles, `.env.example`, local Compose and self-host guide.
- Sanitized Terraform or Compose deployment templates for TLS/WSS, Redis, PostgreSQL, encrypted backups and monitoring.
- No password, token, private key or other live credential.

GitHub Pages continues to host the static client. Any operator may self-host Colyseus behind Caddy or Traefik by using the public templates. The public client enables online combat only when its configured `wss://` endpoint passes health, version and authoritative-match checks.

## Release gates

Multiplayer may be called playable only after automation proves:

1. Two browsers complete build, train, research, combat, reconnect and victory against the same authoritative state.
2. Repeating a `commandId` ten times applies it once.
3. Forged ownership, resource, era, visibility and range commands are rejected without mutation.
4. Fog payloads contain no hidden enemy state.
5. A 10,000-tick replay produces the same canonical hash.
6. Five players plus AI remain stable under 50, 100 and 200 ms latency, two-percent packet loss and packet reordering.
7. Reconnect restores the same server tick, wallet, queues, entities and final hash.
8. Protocol/rules mismatches fail explicitly.
