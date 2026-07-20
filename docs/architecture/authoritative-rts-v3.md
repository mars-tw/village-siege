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

The current `VillageAssaultRuntime` intentionally owns a complete `MatchState` because it is the offline single-player authority. It is not a secrecy or anti-cheat boundary. The future online transport must never instantiate that authority in a player browser: it may deliver only the recipient's `VisibleSnapshot`, projected events and command acknowledgements.

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
- Canonical state hash: every 2 seconds. The current FNV-1a checksum is a deterministic change/desync hint, not a cryptographic authentication or security proof; authenticated online transport requires a server-held integrity mechanism.
- Reconnect lease: 120 seconds.
- Determinism: integer or fixed-point values, seeded random state, stable entity IDs and explicit sorted iteration.
- Hash mismatch: stop delta application and request a full server snapshot; never accept a client state upload as truth.

Snapshots include player/team state, resources, population, settlement tier, research, visibility, entities, orders, queues, projectiles, AI seed/state, victory state, server tick and PRNG state. Fog filtering occurs before serialization, so hidden live enemy data never reaches the browser.

## Technology research contract

Version `village-siege/0.6.0` defines seven original technologies in shared content. A `research` command names the producing building and technology; the server or offline shared simulation validates ownership, building completion and survival, settlement tier, prerequisite technologies, player-global duplicate state, resources and the five-slot queue limit before charging once. Pending or completed duplicates return the explicit `DUPLICATE_RESEARCH` rejection instead of being conflated with a missing prerequisite.

Training and research share one FIFO production lane per building. Production is lost without refund if the building is destroyed. A completed technology emits `technologyResearched`, enters the player's canonical sorted completion list and affects actions beginning on the following simulation tick. Economy, attack, maximum hit points, unit speed and building durability are computed through pure derived-stat functions so current entities, future entities, AI, replay and canonical hashes use the same values.

The fixed seven-slot client dock is presentation only. It may show locked reasons, queue position, progress and completion notices, but it never grants a technology locally. AI personalities submit the same command and use distinct deterministic priority lists and research intervals.

## Production cancellation and rally contract

Every training or research entry owns a deterministic identity `{ commandSequence, itemIndex }`, its enqueue-time total duration and an immutable paid-cost snapshot. A cancellation command names the owned producer plus that identity; queue indices are display-only and never authority. A stale identity returns `PRODUCTION_JOB_NOT_FOUND` without mutating resources, population reservations or a different queue entry.

Village Siege uses an original progress-weighted refund rule. A waiting job refunds its full paid cost. An active job refunds `floor(paidCost × remainingTicks / totalTicks)` independently for food, wood and stone. A zero-tick job blocked at its exit refunds zero. Destroying a producer still loses its whole queue without a voluntary-cancellation event or refund. Research cancellation removes the pending duplicate lock but never grants the technology.

Only completed, living buildings that train units may store a rally point. The target must be an in-bounds, walkable, unoccupied exact grid cell with a deterministic route from a legal producer perimeter. Training completion first uses the canonical free spawn perimeter; a valid current route then gives the new unit a move order. If later construction invalidates the rally, production still completes and the new unit stays idle instead of blocking the FIFO lane.

Production queues, job identities and rally points are owner-only state. They are intentionally absent from `PublicEntityState`; an authoritative online transport must filter the related events to the owning player. AI receives only `ownProductionQueues` and `ownRallyPoints`, sets a stable local military rally once before affordable production, and cancels a tail training job only to recover from a real population-capacity deficit.

## Tactical combat contract

Rules version `village-siege/0.8.0` has one canonical combat roster: `villager` plus `warrior`, `shieldBearer`, `archer`, `mage`, `musketeer`, `boarRider` and `heavyCrossbowman`. Formal unit content derives combat hit points, damage, cadence, range, speed, cost, population and training time from that roster rather than maintaining a second simulation table.

Per-player visibility is deterministic shared state. Living units and completed allied buildings reveal circular tile ranges; teammates share current vision, while explored tiles remain permanently known. Moving hostile units disappear outside current vision. Hostile buildings retain a copied last-sighting record that never references or updates from hidden live state, and revisiting any cell of an empty remembered footprint removes the stale record. `toVisibleSnapshot()` filters entities and projectiles before serialization, masks hidden source/target identifiers and target points, and publishes only the recipient wallet, technology state, RLE exploration mask and stable checksum. `projectDomainEventsForPlayer()` accepts a same-tick `DomainEventFrame`, rejects tick mismatches and applies the same boundary to battle events; command acknowledgement routing remains explicitly recipient-owned. The client draws stale buildings as non-interactive translucent observations and moves projectile effects only from successive public snapshot positions.

Move, attack, attack-move, patrol, stop, repair, stance, formation and active-ability intents are strictly parsed and validated by the shared simulation. Attack-move acquires only currently visible hostile targets and resumes its deterministic formation destination after contact. Formation cells are assigned in stable entity-ID order. Repair accepts living completed allied buildings, charges one wood per ten repaired hit points and stops at full durability or an empty wallet.

Combat advances through fixed windup, commit, recovery and ready phases. Unit-target abilities recheck unit type, hostility, visibility and range at commit; stagger interrupts an active windup. Armor, counter modifiers, technology, status and structure multipliers resolve through the shared integer damage path. Ranged commits create authoritative projectile IDs and impact ticks; terrain-sensitive heavy bolts stop at the first blocked village cell. Damage, phase, projectile and status events drive presentation effects but never grant the client combat authority.

Every combat role also owns an authoritative passive transition. Warrior rhythm resets on a target switch or a twenty-tick miss window; shield bearers brace after eight stationary ticks and reverse frontal boar charges for a sixty-tick lockout; rested musketeers gain one range and twenty-percent shorter recovery for one basic shot; boar riders consume three moved tiles for a twenty-percent basic-hit bonus; and heavy crossbow crews emplace after twenty stationary ticks, gaining one range and twenty-percent building damage until movement or forced displacement. Archer gap-hunter bonus applies to heavy crossbows only while they are emplaced, while mage armor ignore remains part of the common damage formula. Public unit state exposes deterministic passive progress without exposing hidden orders.

Projectile kind controls collision authority. Ordinary arrows are ballistic: they retain the committed target cell, follow their launch-time terrain-checked segment and miss a unit that leaves that exact cell before impact. Ground-area skills scan the target circle at impact, and the three-arrow volley caps one target at two hits. Line bolts advance along their segment every simulation tick, remember already-hit targets, stop after two hits or the first building footprint, and terminate early at blocked terrain. A unit entering a segment after the bolt has passed is not retroactively hit. Projectile impact events report the real terminal cell, not an unrelated endpoint.

Diplomacy uses team IDs in direct attacks, automatic acquisition, towers, projectiles and AI observations. Same-team entities are never valid hostile targets. AI uses only visible hostile composition to score canonical counter units and submits the same validated ability commands as a player.

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
