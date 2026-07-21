# TASK-021 authoritative online rendering audit — 2026-07-21

## Decision

**APPROVE.** Independent Codex review and Grok CLI session `019f83b2-db94-75f3-8302-4136acee8214` both ended at `P0=0 P1=0 P2=0`. This decision closes TASK-021 only. TASK-022 still owns latency, packet-loss, malicious-traffic, five-player-plus-AI and final-hash end-to-end gates.

## Delivered boundary

- `VisibleSnapshot` now carries a sorted public participant roster, the recipient's settlement advancement, safe activity hints and `ownerControl` only on recipient-owned buildings. Delta construction, application, checksum guards and privacy tests cover all new fields.
- `MultiplayerLobbyScene` hands off exactly once on the first verified frame, passing the same `MultiplayerClient` to `VillageAssaultScene`.
- `OnlineAssaultMatchSource` owns verified frames, command submission and recovery lifecycle. `AuthoritativeFrameInterpolator` smooths positions between accepted frames, never extrapolates, and resets after a full snapshot, gap or recovery.
- Online `VillageAssaultScene` never creates or steps the single-player runtime. Gather, build, train, research, rally, tactical, ability, stop and surrender actions submit intents; resources, damage, production and victory are rendered from the authoritative public snapshot.
- The initial camera uses the recipient's own visible town center, with an owned building/unit fallback. Team palettes derive from the public participant village rather than a fixed local faction.
- Exclusive pointer ownership prevents a second touch from completing or converting the first gesture. At 568×320 the fixed HUD and all seven primary or nested command slots remain inside the viewport.

## Defects found and closed

1. Initial Colyseus state could expose `players` one update after the rest of the lobby schema. The client now treats that brief state as an empty roster and has a regression test.
2. An art-load failure before `OnlineAssaultMatchSource` creation could retain the match client and replay a stale frame after returning to the lobby. Both the click path and scene cleanup now leave the underlying client; lobby cleanup is registered before subscriptions and handoff is deferred until subscriptions are disposable.
3. The 15-second authority fencing lease was narrower than the reconnect budget and fragile under a delayed first tick or high load. It now uses the existing 120-second budget with a 60-second renewal margin.
4. The initial camera was fixed to the west base. It now resolves the recipient home position; the east-slot `{ x: 14, y: 7 }` case is covered.
5. Seven nested commands left too little compact-mode edge margin. Canvas command width was reduced from 118 to 112 design units and rechecked at 568×320.
6. The standard smoke's privacy assertion still treated the new recipient-owned production control as forbidden. It now rejects `ownerControl` on every non-owned or non-building entity while allowing the intended owner-private field.

## Verification evidence

- Root `npm run verify`: client 72, server 62 and shared 221 tests passed; all workspaces typechecked and built. This was followed by the final camera/cleanup corrections.
- Latest client gate after all corrections: 9 files, 74 tests passed; client typecheck and production Vite build passed.
- Targeted privacy/delta gate: shared replication plus visibility, 31 tests passed.
- Targeted authority lease gate: `MatchRoom`, 15 tests passed.
- Standard real-WebSocket smoke: two clients, filtered delta chain, forced gap/full resync, private seat rejection, forged ownership rejection and Tick 50 snapshot all passed.
- Recovery real-WebSocket smoke: actual reconnect, `recovering`/`resumed`, full snapshot, ordered sequences 0/1/2, continued authority ticks and no duplicate 50-food spend all passed.
- Chromium used two independent browser sessions with different villages to create/join the same code, ready both players, start, enter the authoritative scene and receive an accepted gather intent. A 568×320 pass confirmed document and canvas fit, then visually checked the main and seven-slot nested build docks. Temporary screenshots were removed after review.
- `npm audit --audit-level=high`: 0 vulnerabilities. Secret-pattern scan: 0 matches. `git diff --check`: clean.

## Review history

- Codex first found an online art-failure lifecycle leak and the fixed west-side camera; both were corrected and covered before the final approval.
- Grok first identified the external-shutdown variant of the pre-source cleanup leak. Cleanup now falls back to `multiplayerClient.leave()` when no source exists. The resumed audit inspected the final diff and returned `APPROVE P0=0 P1=0 P2=0`.

## Remaining scope

TASK-022 must still prove the multiplayer product under controlled latency and loss, malicious payloads, fog-boundary attacks, reconnect timing, five player/AI factions and final authoritative hash comparison. Later release tasks still control production deployment, public URLs and open-source publication; this audit does not bypass those gates.
