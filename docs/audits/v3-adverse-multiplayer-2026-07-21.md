# TASK-022 authoritative AI, adverse delivery and security audit — 2026-07-21

## Decision

**APPROVE.** Independent Codex review and Grok CLI session `019f83f0-90ec-7ff0-8e3e-cfe7bd33aa09` both ended at `P0=0 P1=0 P2=0`, including a final re-audit after the browser-discovered CORS correction. This decision closes TASK-022 only. Public WSS infrastructure, deployment, live-service monitoring and release gates remain TASK-023 through TASK-026.

## Delivered boundary

- A private lobby may contain two human players plus three server-owned AI factions. AI participates in the canonical simulation but consumes no network seat, access token, hello, frame or acknowledgement channel.
- `MatchAuthority` runs the shared deterministic AI reducer, orders human and AI commands together, journals the private AI command batch and replans it during recovery before accepting the recorded state hash.
- Rejected AI commands roll back that AI's planner authority before the tick hash is committed. A dedicated regression test drives a real semantic `commandRejected` and proves the resulting post-tick hash matches a tick that never committed the rejected planner transition.
- Five-faction recipient streams preserve fog filtering, owner-only control fields, acknowledgement isolation and atomic recipient-specific delta reconstruction.
- The adverse-delivery smoke uses two real Colyseus clients and five factions. After each Colyseus frame arrives, a deterministic harness applies 50/100/200 ms delay, reordering and exactly one dropped delta out of 50 per recipient. A separate real socket close/reconnect proves the `recovering → resumed` lifecycle.
- Matchmaking HTTP CORS and WebSocket handshake checks use the same exact-origin policy. The official GitHub Pages origin is built in; `ALLOWED_ORIGINS` adds self-hosted origins; production rejects loopback browser origins. Credentialed matchmaking is retained because the Colyseus browser SDK uses `credentials=include`, but it is never combined with `Access-Control-Allow-Origin: *`.
- The static client has an early CSP that disallows inline script, eval, objects and frames while permitting the HTTP/WS connections required by local development. HTTP response limits, no-store and defensive headers are set at the Colyseus boundary.

## Defects found and closed

1. The first adverse smoke used two humans but did not configure the three AI factions claimed by TASK-022. It now configures all three, asserts five public participants on both recipients and reports `factions: 5` plus `serverOwnedAiFactions: 3`.
2. The first WebSocket origin wiring omitted the live `NODE_ENV` fallback, which made `undefined` behave like development. The policy now reads `process.env.NODE_ENV` when no test override is supplied, with a production regression test.
3. The first client CSP omitted `http:` from `connect-src`, which would block local cross-port matchmaking before the WebSocket opened. Local HTTP matchmaking is now permitted; production HTTPS still relies on normal mixed-content enforcement and exact server-origin checks.
4. README limitations still said online rendering, multiplayer E2E, durable storage and per-player rate limiting were missing. Those statements now distinguish completed v0.18 code from the remaining public deployment work.
5. The AI authority rollback path had no direct rejection coverage. A real invalid owned-entity command now produces `commandRejected`, exercises the production rollback helper and checks the deterministic post-tick hash.
6. A 24-character unbroken player name could overflow the narrow 568×320 two-column roster. Both human and AI roster titles now use bounded ellipsis.
7. Removing `Access-Control-Allow-Credentials` entirely broke real browser matchmaking because the Colyseus SDK sends `credentials=include`. The final policy retains that header only with an exact allowed origin; a clean Chromium session and direct preflight checks prove the correction.
8. Early documentation described application-level delay and delta loss as generic network impairment. README, CHANGELOG, architecture and the implementation plan now identify the mechanism as a deterministic post-receive delivery harness. Only socket drop/reconnect is claimed as a real transport event.

## Verification evidence

- Root `npm run verify`: client 9 files / 75 tests, server 8 files / 77 tests and shared 12 files / 224 tests passed; all workspaces typechecked and built. The only build warning is Vite's existing Phaser chunk-size advisory.
- Final CORS correction: server typecheck, production build and `OriginPolicy.test.ts` 5/5 passed after the full root gate.
- Standard real-WebSocket smoke: two humans plus three server AI, private seat handoff, exact negotiation, fog-safe streams, forced gap/full resync, ownership and authority-injection rejection, duplicate cost prevention and Tick 50 snapshot all passed.
- Durable recovery smoke: one real socket drop and reconnect, `recovering → resumed`, full snapshot, ordered pending replay `0,1,2`, ten authority ticks during disconnect and no duplicate 50-food spend passed.
- Five-faction adverse smoke: both recipients processed 50 impaired deltas, dropped one each, detected two gaps each, completed one full resync each, reordered 12 deliveries each, reconnected one real socket and converged at Tick 64 (`401332ba` host, `15786cd0` guest).
- Five-faction AI soak: 600 authoritative ticks, three active AI controllers, zero rejected self-issued commands, recipient delta reconstruction and repeatable recovery/final canonical hash passed.
- Security boundary suites cover identity injection, foreign ownership, hidden targets, private authority fields, ownerControl scoping, acknowledgement isolation, cross-recipient deltas and atomic rejection of forged checksums/events.
- Fresh Chromium at 568×320 created a room from a separate Vite origin with a 24-character name, showed the fixed four-button row and three AI cards without overlap, and recorded 0 errors / 0 warnings. Temporary screenshots and `.playwright-cli` output were removed after visual review.
- Direct preflight evidence: the allowed development origin received itself plus `Access-Control-Allow-Credentials: true`; `https://evil.example` received the non-matching official origin and is therefore rejected by the browser.
- `npm audit --omit=dev`: 0 vulnerabilities. Secret-pattern scan: 0 matches. Disposable browser artifacts and local QA processes were removed/stopped.

## Review history

- Codex audit found and closed the missing five-faction adverse setup, production origin fallback, local CSP regression, stale documentation, rollback coverage gap, long-name overflow and credentialed-browser CORS regression. The final read-only supervisor re-audit returned `P0=0 P1=0 P2=0`.
- Grok inspected the final authority, lobby, visibility, adverse harness, origin/CSP and documentation diff. It approved `P0=0 P1=0 P2=0`; the same session then re-audited the final credentialed exact-origin correction and retained approval.
- The `security-best-practices` review drove exact-origin CORS/WS enforcement, CSP, request size/time limits, defensive headers, dependency audit and secret scanning. It does not substitute for deployment-edge TLS, HSTS, DDoS controls or runtime monitoring.

## Remaining scope

- Delay, loss and reordering are injected after Colyseus delivers a frame. Proxy/netem transport shaping remains a public-deployment test and is not claimed here.
- Physical mobile devices, additional browsers, long-duration load, edge rate limiting, public TLS/WSS, production Redis/PostgreSQL operations and observability remain release gates.
- GitHub Pages still serves the previously published single-player build until TASK-023 through TASK-026 finish and pass their own reviews.
