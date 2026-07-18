---
title: Village Siege Combat and Character Art Rework
version: 1.0.0
date_created: 2026-07-17
last_updated: 2026-07-17
owner: Village Siege production team
tags: [design, combat, character-art, animation, phaser, rts]
---

# Introduction

This specification replaces the geometric placeholder combat presentation with a playable, data-driven combat vertical slice. It defines seven original player units, three neutral monster archetypes, a bounded counter system, active and passive abilities, deterministic projectiles and statuses, six-direction character animation, and the Phaser integration contracts required to make those systems readable and controllable in play.

## 1. Purpose & Scope

The first accepted vertical slice shall provide a 12–15 minute single-player skirmish in which the player can field all seven combat units, identify them without relying on color, use an active skill, observe counter relationships, fight neutral monsters, and win or lose through combat. The same combat definitions shall remain suitable for later authoritative Colyseus integration.

In scope:

- Seven player units: `warrior`, `shieldBearer`, `archer`, `mage`, `musketeer`, `boarRider`, `heavyCrossbowman`.
- Three neutral monsters: `miremaw`, `ashwing`, `rootback`.
- Damage, armor, counter, status, skill, projectile and cooldown data contracts.
- Six-direction facing: `e`, `ne`, `nw`, `w`, `sw`, `se`.
- `idle`, `walk`, `attack`, `hurt`, `death`, `cast` animation states.
- A playable Phaser skirmish and combat HUD.
- Original character silhouettes and project-owned art direction.

Out of scope for this vertical slice:

- Full technology tree, eras, naval units, equipment inventory, ranked matchmaking and 4v4.
- Claiming complete multiplayer battles before the shared combat simulation is connected to Colyseus snapshots.
- Claiming final sprite production when only concepts, procedural previews or incomplete directions exist.

## 2. Definitions

- **Counter multiplier**: A bounded matchup modifier applied before armor. Values shall be between `0.75` and `1.30`.
- **Facing**: One of six visual orientation sectors selected from an isometric screen-space vector.
- **Windup**: Readable pre-commit animation during which a skill may be interrupted.
- **Commit**: The authoritative tick that creates damage, a status or a projectile.
- **Recovery**: Post-commit period before another action may begin.
- **Telegraph**: A silhouette, pose or ground cue shown before a dangerous action commits.
- **Team-color zone**: A bounded cloth or equipment region that changes by faction and is not the only identification method.
- **Vertical slice**: A small but complete playable battle proving interaction, feedback, art, rules and testing together.

## 3. Requirements, Constraints & Guidelines

### 3.1 Combat requirements

- **REQ-001**: The combat roster shall contain exactly the seven player unit IDs declared in section 1.
- **REQ-002**: Every unit shall define HP, armor class, armor, damage type, base damage, attack interval, range, speed, cost, population, one active ability, one passive ability, animation profile and projectile profile where applicable.
- **REQ-003**: Every unit shall have at least two favorable and two unfavorable matchups; no row in the counter matrix may have all values greater than or equal to `1.00`.
- **REQ-004**: Counter multipliers shall remain within `0.75–1.30`; combined damage multipliers shall be capped at `2.25`.
- **REQ-005**: Damage shall be deterministic and use integer-safe rounding. No random critical hits or client-supplied damage are allowed.
- **REQ-006**: Active abilities shall follow `windup → commit → recovery → ready`; cooldown begins at commit.
- **REQ-007**: The first slice shall support `armorBreak`, `slow`, `burn`, `stagger`, `tenacity`, `shieldWall` and `emplaced` statuses with non-infinite stacking rules.
- **REQ-008**: Player attacks and abilities shall not damage allies. Neutral monster area abilities may damage every player faction but not monsters from the same camp.
- **REQ-009**: Ranged attacks shall visibly distinguish arrows, magic projectiles, musket hitscan feedback and heavy bolts.
- **REQ-010**: The skirmish shall contain at least one monster of each of the three declared archetypes and shall reward defeating them without making the reward an automatic win.

### 3.2 Unit identities

- **REQ-011**: `warrior` is sustained melee and armor break; active ability `armorSunder`.
- **REQ-012**: `shieldBearer` is frontal projectile protection and charge denial; active ability `shieldWall`.
- **REQ-013**: `archer` is mobile ranged pressure; active ability `pinningVolley`.
- **REQ-014**: `mage` is armor-ignoring area pressure; active ability `emberSigil`.
- **REQ-015**: `musketeer` is long-windup high-impact hitscan; active ability `aimedShot`.
- **REQ-016**: `boarRider` is fast rear-line disruption; active ability `tuskCharge`.
- **REQ-017**: `heavyCrossbowman` is slow anti-mounted and anti-structure fire support; active ability `breachingBolt`.

### 3.3 Character-art and animation requirements

- **ART-001**: Every unit and monster shall have a silhouette distinguishable at native game scale and in grayscale.
- **ART-002**: Six facing IDs are fixed as `e`, `ne`, `nw`, `w`, `sw`, `se`; asymmetric equipment shall not be produced by mirroring three directions.
- **ART-003**: Each unit and monster shall expose `idle`, `walk`, `attack`, `hurt`, `death`, `cast` animation metadata even when the first playable renderer uses a procedural articulated preview.
- **ART-004**: Required animation metadata includes `frames`, `fps`, `loop`, `commitFrame`, `projectileFrame`, pivot and native frame size.
- **ART-005**: A production atlas shall use hard-edged RGBA PNG, nearest filtering, fixed pivots, 4 px padding, 4 px border and 2 px color extrusion.
- **ART-006**: The first visual signature shall be practical frontier equipment: wool, linen, worn leather, willow wood, blackened iron and sparse copper; ornate gold armor and commercial-game heraldry are prohibited.
- **ART-007**: Team color shall occupy 8–14% of visible pixels in at least two separated upper-body or equipment regions.
- **ART-008**: Attack windups shall change the silhouette; full-body white flashing is prohibited as the only hurt feedback.
- **ART-009**: Generated concept images are references, not shippable atlases, until frame, direction, pivot, alpha, originality and in-game QA pass.

### 3.4 Playability and UI requirements

- **PLAY-001**: The battle scene shall present all seven player units in a selectable roster and at least three monster types.
- **PLAY-002**: Clicking a unit shall show role, armor, damage type, HP, active skill, cooldown and counter hints.
- **PLAY-003**: An explicit ability control and keyboard shortcut shall be available for the selected player unit.
- **PLAY-004**: The player shall receive readable feedback for valid targets, cooldown, damage, healing or status changes.
- **PLAY-005**: At least three mixed-unit strategies shall be viable; a single unit type shall not be the only reliable solution.
- **PLAY-006**: The scene shall expose a clear victory and defeat condition and support restarting without reloading the page.

### 3.5 Constraints

- **CON-001**: The existing 10 Hz deterministic shared simulation remains the authority target.
- **CON-002**: Phaser rendering must not decide damage or cooldown completion.
- **CON-003**: No Age of Empires II art, UI, names, sound, heraldry, palette or animation may be copied.
- **CON-004**: The current client may use an articulated code-rendered animation preview only as an implementation scaffold; it cannot be called final character art.
- **CON-005**: Runtime assets shall live below `apps/client/public/assets`; source concepts and art manifests shall remain below project `assets/source` and `assets/manifests`.
- **CON-006**: At 1280×720, 100 active units and projectiles shall target 60 FPS on the reference desktop.

## 4. Interfaces & Data Contracts

```ts
type CombatUnitId =
  | "warrior" | "shieldBearer" | "archer" | "mage"
  | "musketeer" | "boarRider" | "heavyCrossbowman";

type ArmorClass = "heavy" | "guard" | "light" | "cloth" | "mounted" | "siegeCrew";
type DamageType = "slash" | "impact" | "pierce" | "arcane" | "shot" | "charge" | "siegePierce";
type Facing = "e" | "ne" | "nw" | "w" | "sw" | "se";
type AnimationState = "idle" | "walk" | "attack" | "hurt" | "death" | "cast";

interface CombatUnitDefinition {
  id: CombatUnitId;
  displayName: string;
  role: string;
  maxHitPoints: number;
  armorClass: ArmorClass;
  armor: number;
  damageType: DamageType;
  baseDamage: number;
  attackIntervalMs: number;
  attackRange: number;
  moveSpeed: number;
  cost: { food: number; wood: number; stone: number };
  population: number;
  activeAbility: AbilityDefinition;
  passive: PassiveDefinition;
  counterModifiers: Readonly<Record<CombatUnitId, number>>;
  animationProfileId: string;
  projectileProfileId?: string;
}

interface AbilityDefinition {
  id: string;
  displayName: string;
  cooldownMs: number;
  windupMs: number;
  recoveryMs: number;
  targeting: "self" | "unit" | "ground" | "direction";
  description: string;
}

interface AnimationClipDefinition {
  state: AnimationState;
  facing: Facing;
  frames: number;
  fps: number;
  loop: boolean;
  commitFrame?: number;
  projectileFrame?: number;
}
```

Damage calculation:

```text
effectiveArmor = max(0, armor × (1 - armorIgnore) - armorBreak)
damage = max(1, round(baseDamage × counter × skill × status × 100 / (100 + effectiveArmor)))
```

Animation keys:

```text
unit.{unitId}.{state}.{facing}
monster.{monsterId}.{state}.{facing}
proj.{projectileId}.flight.{facing}
fx.{effectId}.{state}.{facingOrOmni}
```

## 5. Acceptance Criteria

- **AC-001**: Given the roster view, when all units are shown in grayscale, then a reviewer can identify all seven by silhouette and weapon.
- **AC-002**: Given every 7×7 matchup, when damage is calculated, then the declared counter multiplier is within `0.75–1.30` and the result matches the deterministic formula.
- **AC-003**: Given a selected unit, when its active ability is ready, then the HUD shows its name, target rules and cooldown, and activation creates the specified telegraph before commit.
- **AC-004**: Given a direction change, when a unit moves or attacks, then facing resolves to one of six IDs without rapid oscillation near sector boundaries.
- **AC-005**: Given an archer, mage, musketeer and heavy crossbowman attack, then each uses a visually distinct projectile or hitscan effect and damage occurs at the authoritative commit/impact point.
- **AC-006**: Given a shield wall, when attacks arrive from front, side and back, then only the declared frontal arc receives mitigation.
- **AC-007**: Given a skirmish, when the player mixes front line, ranged units and a skill, then monsters can be defeated and a victory state can be reached.
- **AC-008**: Given client build and tests, when `npm run verify` runs, then typecheck, unit tests and production build pass.
- **AC-009**: Given the battle in Chromium, then the console contains zero errors and zero warnings attributable to project code.
- **AC-010**: Given an image or atlas candidate, it shall not be promoted to runtime until originality, direction, frame, pivot, alpha and in-game QA pass.

## 6. Test Automation Strategy

- **Unit tests**: Vitest validates roster completeness, counter bounds, damage, status stacking, cooldowns, facing quantization and animation metadata.
- **Simulation tests**: Fixed-seed battles verify replay hashes and legal AI commands over 10,000 ticks.
- **Integration tests**: Phaser scene creation validates unit spawning, selection, ability input, projectile lifecycle, victory and restart.
- **Browser tests**: Playwright captures 1280×720, 1600×900 and 1920×1080 evidence; checks console, controls and visible unit identities.
- **Performance tests**: A debug scenario spawns 100 units and records frame-time p95; later server tests cover 200 combat entities at 10 Hz.
- **Art validation**: Manifest checks verify all direction/state/frame keys, pivots, dimensions, hashes and project-original attribution.

## 7. Rationale & Context

The previous prototype embedded three geometric unit drawings and one generic projectile directly inside `MatchScene`. That prevented artists and designers from changing content independently, made every attack feel identical and left the AI selector disconnected from a complete combat model. This rework uses data-driven definitions, an articulated directional renderer and explicit effect profiles so playability can be tested before final atlas production, while keeping the final art acceptance bar separate and unambiguous.

## 8. Dependencies & External Integrations

- **PLT-001**: Phaser renderer and animation system.
- **PLT-002**: TypeScript shared-domain package for deterministic combat data.
- **PLT-003**: Vitest for combat and metadata tests.
- **PLT-004**: Playwright or equivalent Chromium automation for visual QA.
- **DAT-001**: Project-owned art bible, concept references, sprite manifests and attribution data.
- **INF-001**: Existing Vite client and later Colyseus authoritative server.

## 9. Examples & Edge Cases

- A unit with zero movement retains its previous facing; if none exists it defaults to `se`.
- A target that dies before a locked projectile impact causes the projectile to dissipate without selecting a new target.
- A staggered skill before commit enters 30% cooldown; after commit it cannot be canceled retroactively.
- A shield wall protects only attacks inside its frontal arc and never reduces arcane damage.
- A dead unit remains in `death` and cannot return to `idle` after a network correction.
- A unit at a facing boundary uses hysteresis to avoid alternating between two directions each frame.

## 10. Validation Criteria

- Seven player unit definitions and three monster definitions exist exactly once in shared data.
- Every unit has complete counter, ability, passive, visual and animation metadata.
- All automated tests and production build pass.
- The first playable skirmish supports selection, movement, attack, one active skill, monster combat, victory and restart.
- Visual evidence shows differentiated silhouettes and effects; generic circles or triangles alone are not accepted as final character art.
- Runtime and source asset manifests contain licensing and hash information.

## 11. Related Specifications / Further Reading

- `docs/rework/combat-roster-draft.md`
- `docs/rework/art-bible-draft.md`
- `docs/rework/technical-gap-draft.md`
- `spec/spec-design-village-siege.md`
- `docs/production-workflow.md`
