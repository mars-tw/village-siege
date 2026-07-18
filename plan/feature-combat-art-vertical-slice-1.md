---
goal: Replace placeholder combat with a playable seven-unit six-direction vertical slice
version: 1.0.0
date_created: 2026-07-17
last_updated: 2026-07-17
owner: Village Siege production team
status: 'In progress'
tags: [feature, combat, character-art, phaser, vertical-slice]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

This plan executes `spec/spec-design-combat-art-rework.md`. Planning is complete before production changes begin. The first construction pass delivers shared combat definitions, an articulated six-direction Phaser renderer, seven playable units, three neutral monsters, distinct projectiles, active skills and automated validation. Final bitmap atlases remain a separate art gate and cannot be claimed complete until their manifests and in-game evidence pass.

## 1. Requirements & Constraints

- **REQ-001**: Implement seven data-driven player units and three neutral monsters.
- **REQ-002**: Implement deterministic armor, damage, counters, statuses, cooldowns, abilities and projectile profiles.
- **REQ-003**: Implement six-direction facing and six animation states for every actor profile.
- **REQ-004**: Deliver a playable single-player skirmish with selection, movement, attacks, skills, monster encounters, victory and restart.
- **REQ-005**: Distinguish unit silhouettes and ranged effects without relying only on faction colors.
- **CON-001**: Preserve current TypeScript strict mode, Phaser 4, Vite and workspace structure.
- **CON-002**: Combat definitions live in `packages/shared`; the client shall not copy balance constants.
- **CON-003**: Procedural articulated art is an implementation scaffold, not final sprite-atlas approval.
- **CON-004**: Do not copy commercial RTS characters, UI, icons, animation or art.
- **GUD-001**: Use one active ability and one passive per unit for the first slice.
- **PAT-001**: Rendering, input, combat rules and effects communicate through typed data and events rather than direct cross-module mutation.

## 2. Implementation Steps

### Implementation Phase 1 — Planning gate

- GOAL-001: Freeze the combat, art and technical contracts before changing production code.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `docs/rework/combat-roster-draft.md` with roster, matrix, skills, monsters and tests. | ✅ | 2026-07-17 |
| TASK-002 | Create `docs/rework/art-bible-draft.md` with silhouettes, six directions, animation frames, atlas and VFX contracts. | ✅ | 2026-07-17 |
| TASK-003 | Create `docs/rework/technical-gap-draft.md` with current gaps and file-level implementation architecture. | ✅ | 2026-07-17 |
| TASK-004 | Create and supervisor-review `spec/spec-design-combat-art-rework.md` and this implementation plan. | ✅ | 2026-07-17 |

### Implementation Phase 2 — Shared combat core

- GOAL-002: Provide a deterministic single source of truth for roster, damage, counters and facing.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Add `packages/shared/src/combat.ts` with roster, counter matrix, abilities, monsters, damage and facing functions. |  |  |
| TASK-006 | Add `packages/shared/src/combat.test.ts` covering completeness, bounds, damage, status and direction rules. |  |  |
| TASK-007 | Export the combat module from `packages/shared/src/index.ts` without breaking current simulation exports. |  |  |

### Implementation Phase 3 — Character presentation and effects

- GOAL-003: Replace geometric placeholder characters with differentiated articulated six-direction actors and effects.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Add `apps/client/src/game/combatArt.ts` to render each class and monster from a unique articulated equipment recipe. |  |  |
| TASK-009 | Add `apps/client/src/game/directionalAnimation.ts` for six-sector quantization, hysteresis and animation timing. |  |  |
| TASK-010 | Add `apps/client/src/game/combatEffects.ts` for arrows, magic cinders, musket flash/smoke, heavy bolts and melee impacts. |  |  |
| TASK-011 | Add `assets/manifests/combat-art-v1.json` documenting profiles, directions, states, ownership and final-atlas readiness. |  |  |

### Implementation Phase 4 — Playable skirmish

- GOAL-004: Integrate the roster and art into a complete, replayable battle scene.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Refactor `apps/client/src/scenes/MatchScene.ts` to spawn all seven units, three monsters and data-driven actors. |  |  |
| TASK-013 | Implement move, target, attack, counter damage, cooldown, active ability, hurt, death and victory state transitions. |  |  |
| TASK-014 | Extend `apps/client/src/ui/hud.ts` and `style.css` with role, armor, damage, skill button, cooldown and restart controls. |  |  |
| TASK-015 | Implement standard AI target selection and basic ability use without hidden-state access. |  |  |

### Implementation Phase 5 — Art production and integration

- GOAL-005: Generate and approve original concept anchors before producing final sprite atlases.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Generate a seven-class original concept lineup with the built-in image generation workflow and preserve it in project source assets. |  |  |
| TASK-017 | Supervisor-review silhouettes and originality; reject any commercial-game resemblance or unreadable class. |  |  |
| TASK-018 | Produce per-character six-view turnarounds, key poses and final atlas frames under the art bible gates. |  |  |
| TASK-019 | Replace scaffold rendering with approved atlases only after frame/pivot/alpha/manifest validation. |  |  |

### Implementation Phase 6 — Verification and handoff

- GOAL-006: Prove playability, visual readability, stability and clean handoff.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-020 | Run shared tests, client typecheck and production build; fix all errors. |  |  |
| TASK-021 | Run Chromium at three resolutions; capture roster, skill, projectile, monster and victory evidence with zero project errors/warnings. |  |  |
| TASK-022 | Supervisor-review playability and art; independent auditor reruns evidence and checks scope claims. |  |  |
| TASK-023 | Write compressed handoff, then remove only run-scoped build/browser/image-generation garbage after audit approval. |  |  |

## 3. Alternatives

- **ALT-001**: Continue drawing units directly inside `MatchScene`. Rejected because it prevents reusable animation, testing and artist ownership.
- **ALT-002**: Generate a giant sprite sheet in one image-model call. Rejected because exact frame counts, pivots and character consistency cannot be trusted without staged concept and manual QA.
- **ALT-003**: Copy a classic RTS visual style closely. Rejected for originality, licensing and product-identity reasons.
- **ALT-004**: Wait for all final bitmap frames before testing combat. Rejected because rules and playability need validation early; an articulated scaffold can exercise the complete contract while final art proceeds behind a separate gate.

## 4. Dependencies

- **DEP-001**: Existing `@village-siege/shared` TypeScript workspace.
- **DEP-002**: Phaser scene, Graphics, Container, Tween and input APIs.
- **DEP-003**: Vitest for deterministic combat tests.
- **DEP-004**: Built-in image generation workflow for project-owned concept anchors.
- **DEP-005**: Playwright/Chromium for visual and interaction verification.

## 5. Files

- **FILE-001**: `packages/shared/src/combat.ts` — combat data and pure functions.
- **FILE-002**: `packages/shared/src/combat.test.ts` — combat validation.
- **FILE-003**: `packages/shared/src/index.ts` — public combat exports.
- **FILE-004**: `apps/client/src/game/combatArt.ts` — differentiated actor rendering.
- **FILE-005**: `apps/client/src/game/directionalAnimation.ts` — facing and animation state.
- **FILE-006**: `apps/client/src/game/combatEffects.ts` — projectiles and impacts.
- **FILE-007**: `apps/client/src/scenes/MatchScene.ts` — skirmish integration.
- **FILE-008**: `apps/client/src/ui/hud.ts` — combat information and controls.
- **FILE-009**: `apps/client/src/style.css` — skill and battle HUD styling.
- **FILE-010**: `assets/manifests/combat-art-v1.json` — ownership and readiness manifest.

## 6. Testing

- **TEST-001**: Roster contains exactly seven unique player unit IDs and three unique monster IDs.
- **TEST-002**: Counter matrix is complete, bounded and gives every unit at least two favorable and two unfavorable matchups.
- **TEST-003**: Damage formula is deterministic, armor-safe and multiplier-capped.
- **TEST-004**: Six-direction quantization returns valid, stable facings for boundary vectors.
- **TEST-005**: Every unit and monster has six directions and six animation states in metadata.
- **TEST-006**: Client typecheck and production build pass.
- **TEST-007**: Browser can select every unit, use an ability, damage a monster, observe a projectile/effect, reach victory and restart.
- **TEST-008**: Browser console has zero project errors and warnings.
- **TEST-009**: Art manifest contains project-original ownership and no runtime asset is marked final before QA.

## 7. Risks & Assumptions

- **RISK-001**: Seven units plus three monsters can overwhelm the first implementation. Mitigation: freeze one ability/passive each and one skirmish map.
- **RISK-002**: Generated concepts may drift between directions. Mitigation: approve lineup, then one subject and one facing at a time before atlas work.
- **RISK-003**: Procedural scaffold may again be mistaken for final art. Mitigation: manifest readiness is `scaffold`, UI evidence labels it, and final claims require atlas QA.
- **RISK-004**: Counter numbers may create a dominant unit. Mitigation: bounded matrix and automated equal-cost simulations in the next balance pass.
- **ASSUMPTION-001**: The ambiguous requested ranged unit is implemented as an original heavy crossbowman; display name remains changeable without changing its ID.
- **ASSUMPTION-002**: “Six-dimensional view” means six-direction facing for the 2:1 isometric camera.

## 8. Related Specifications / Further Reading

- `spec/spec-design-combat-art-rework.md`
- `docs/rework/combat-roster-draft.md`
- `docs/rework/art-bible-draft.md`
- `docs/rework/technical-gap-draft.md`
