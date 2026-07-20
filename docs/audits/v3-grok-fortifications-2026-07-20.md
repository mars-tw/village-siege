# v0.9 fortifications — Codex + Grok final audit

Date: 2026-07-20

Scope: `TASK-011` only — wall, gate, landmark, rubble and their open, closed, damaged and destroyed pathing transitions.

Branch: `codex/rts-complete-v3`

## Decision

**PASS for TASK-011.** Grok's read-only final audit reported no P0 or P1 findings. This decision does not mark the full RTS plan complete.

Two independent Codex audit workers then reviewed the final shared-rules and mobile/UI changes. Both also reported PASS with no reproducible P0 or P1 finding.

## Audited contracts

- Placement occupancy and navigation blocking are separate authoritative queries.
- A survey gate has a strict north-east or south-east two-cell orientation.
- Incomplete, closed and damaged gates block movement; an open completed gate is walkable but still reserves its construction footprint.
- Closing a gate over a living unit is rejected without mutating the match.
- A blocked unit retains its destination and resumes after an observed opening or breach.
- Destroyed configured fortifications create neutral, walkable, placement-blocking rubble in stable source-ID order; rubble expires after 200 ticks.
- Construction damage is retained at completion rather than being healed by the completion transition.
- Public snapshots and stale sightings expose only observed gate topology; hidden state changes do not update enemy memory or path planning.
- Fortification placement and gate control each use exactly seven Canvas dock actions on the validated landscape-phone viewports.
- Fortification visuals are original code-native Phaser drawings: resin-lashed timber and shale gabions, an asymmetric survey gate, an oxidized copper survey landmark and matching breach rubble.

## Automated and browser evidence

- Shared deterministic tests: 147 passed before audit; Grok's two P2 coverage cases were then added for incomplete-gate blocking and multi-structure same-tick rubble ordering. The final suite passed 148/148 tests across seven files.
- Workspace TypeScript checks: passed before audit.
- Production build: passed before audit.
- Local multiplayer room/reconnect smoke test: passed after audit.
- Production dependency audit: zero vulnerabilities after audit.
- Playwright browser flow: selected workers, opened the fourth build page, rotated and successfully placed a survey gate, then selected the completed gate and observed its seven-action open/closed control dock.
- Landscape geometry: 568×320, 667×375 and 844×390 fit the viewport with seven actions and no document scrolling; browser console reported zero errors.

## Non-blocking observations

- The shared rejection code for closing an occupied gate is the existing `TARGET_NOT_REACHABLE`; the client therefore uses the general occupied/unreachable warning instead of a gate-specific protocol code.
- End-of-match actions are intentionally a two-button result screen and are outside the seven-action in-match fortification dock contract.
- Placement mode previews the rotated authoritative footprint rather than the complete building illustration; the axis label remains the rotation cue, especially for the square copper landmark.

## Remaining full-game milestones

The next planned slice is `TASK-012`: original continuous terrain, fortified layouts, neutral threats, civilian activity and breach effects across three to five village starts. Strategic wall-aware AI, expanded victory modes, versioned save/replay, authoritative online combat and public two-client deployment remain later gates.
