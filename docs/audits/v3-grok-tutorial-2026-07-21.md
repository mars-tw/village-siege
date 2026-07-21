# TASK-017 interactive tutorial audit — 2026-07-21

## Decision

**APPROVE.** Codex independent review and Grok CLI final recheck both report no open P0, P1 or P2 findings.

Grok CLI session: `019f8203-0ddb-72c1-9f96-9412f9f521bf`.

## Accepted scope

- Seven sequential objectives: economy deposit, settlement advancement, technology research, fog exploration, combat damage, enemy fortification breach and player-team victory.
- Economy, advancement, research, exploration, combat and breach evidence begins only after an accepted human command. Opening worker automation, player tower fire, friendly breaches, defeats and draws do not advance the guide.
- Delayed ranged damage remains attributable without leaking hidden state: a projectile spawned by a commanded player unit is recorded from the projected event, and masked `sourceId: null` damage counts only when that same projectile visibly impacts the same hostile target.
- Tutorial progress consumes `VisibleSnapshot`, projected `DomainEvent` data and accepted local commands. It does not inspect private AI memory or fog-hidden entities.
- Tutorial mode selects novice AI timing but uses the same resources, visibility, damage, command validation and victory policy as a normal match.
- Importing a save or replay closes the guide explicitly instead of carrying command evidence into a different match.

## Mobile and accessibility gate

- Real Chromium checks: 568×320, 667×375, 844×390 and 1280×720 reported viewport-sized documents with no scroll overflow and no console errors.
- 390×844 portrait mode hid and disabled all seven Canvas/DOM control proxies, released focus and blocked world pointer, wheel and keyboard commands. Returning to landscape restored focus to the first enabled action and announced recovery through the live region.
- The pre-match footer remains exactly three actions. The in-match command dock remains one fixed seven-slot row; the tutorial system page uses six actions and no modal overlay.
- A real mobile-sized interaction entered the tutorial, selected all workers, issued direct wood gathering and advanced the first objective through a later projected deposit event.
- Direct gather buttons for food, wood and stone avoid ambiguous taps where resources visually overlap adjacent fortifications.

## Automated gate

- Tutorial controller: 7/7 tests.
- Client suite: 26/26 tests.
- Shared suite: 205/205 tests.
- All client, server and shared TypeScript checks passed.
- Client and server production builds passed. Vite retained only the existing advisory for a JavaScript chunk larger than 500 kB.
- `git diff --check` passed; line-ending conversion warnings are informational.

This approval closes TASK-017 only. Full server-authoritative battlefield multiplayer remains TASK-018 through TASK-022, and later release/security/deployment tasks remain open.
