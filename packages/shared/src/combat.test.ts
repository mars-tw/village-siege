import { describe, expect, it } from "vitest";
import {
  COMBAT_UNIT_IDS,
  COMBAT_UNITS,
  COUNTER_MATRIX,
  FACING_DIRECTIONS,
  MONSTER_IDS,
  MONSTERS,
  PROJECTILE_PROFILES,
  STATUS_EFFECT_IDS,
  STATUS_EFFECTS,
  calculateDamage,
  quantizeFacing,
  validateCombatData,
  type CombatUnitId,
  type Facing,
} from "./combat";

describe("combat data", () => {
  it("defines exactly seven complete units and three original monsters", () => {
    expect(Object.keys(COMBAT_UNITS)).toEqual([...COMBAT_UNIT_IDS]);
    expect(Object.keys(MONSTERS)).toEqual([...MONSTER_IDS]);
    expect(new Set(COMBAT_UNIT_IDS).size).toBe(7);
    expect(new Set(MONSTER_IDS).size).toBe(3);

    for (const id of COMBAT_UNIT_IDS) {
      const unit = COMBAT_UNITS[id];
      expect(unit.id).toBe(id);
      expect(unit.maxHitPoints).toBeGreaterThan(0);
      expect(unit.baseDamage).toBeGreaterThan(0);
      expect(unit.activeAbility.id).toBeTruthy();
      expect(unit.passive.id).toBeTruthy();
      expect(unit.animationProfileId).toBeTruthy();
    }

    for (const id of MONSTER_IDS) {
      const monster = MONSTERS[id];
      expect(monster.id).toBe(id);
      expect(monster.activeAbility.targetFilter).toBe("allPlayers");
      expect(monster.animationProfileId).toBe(`monster.${id}`);
    }
  });

  it("passes the production registry validator", () => {
    expect(validateCombatData()).toEqual({ ok: true, errors: [] });
  });

  it("contains every required bounded counter with two strengths and weaknesses per unit", () => {
    for (const attacker of COMBAT_UNIT_IDS) {
      const row = COUNTER_MATRIX[attacker];
      expect(Object.keys(row)).toEqual([...COMBAT_UNIT_IDS]);
      expect(row[attacker]).toBe(1);
      const values = COMBAT_UNIT_IDS.map((target) => row[target]);
      expect(values.every((value) => value >= 0.75 && value <= 1.3)).toBe(true);
      expect(values.filter((value) => value > 1).length).toBeGreaterThanOrEqual(2);
      expect(values.filter((value) => value < 1).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("links all required statuses and visually distinct ranged profiles", () => {
    expect(Object.keys(STATUS_EFFECTS)).toEqual([...STATUS_EFFECT_IDS]);
    expect(STATUS_EFFECTS.stagger.grantsStatusId).toBe("tenacity");
    expect(STATUS_EFFECTS.burn.maxStacks).toBe(1);
    expect(STATUS_EFFECTS.emplaced.stacking).toBe("state");

    expect(COMBAT_UNITS.archer.projectileProfileId).toBe("arrow");
    expect(COMBAT_UNITS.mage.projectileProfileId).toBe("arcaneCinder");
    expect(COMBAT_UNITS.musketeer.projectileProfileId).toBe("musketTrace");
    expect(COMBAT_UNITS.heavyCrossbowman.projectileProfileId).toBe("heavyBolt");
    expect(PROJECTILE_PROFILES.arrow.kind).toBe("locked");
    expect(PROJECTILE_PROFILES.musketTrace.kind).toBe("hitscan");
    expect(PROJECTILE_PROFILES.breachingBolt.kind).toBe("line");
    expect(Object.values(PROJECTILE_PROFILES).every((profile) => profile.friendlyFire === false)).toBe(true);
  });
});

describe("calculateDamage", () => {
  it("applies counters before armor with deterministic rounding", () => {
    expect(calculateDamage({ baseDamage: 100, armor: 25 })).toBe(80);
    expect(calculateDamage({ baseDamage: 100, armor: 25, counterMultiplier: 1.25 })).toBe(100);
  });

  it("applies armor ignore and armor break without allowing negative armor", () => {
    expect(calculateDamage({ baseDamage: 100, armor: 20, armorIgnore: 0.5 })).toBe(91);
    expect(calculateDamage({ baseDamage: 100, armor: 20, armorBreak: 10 })).toBe(91);
    expect(calculateDamage({ baseDamage: 100, armor: 5, armorBreak: 10 })).toBe(100);
  });

  it("caps combined multipliers and always deals at least one damage", () => {
    expect(calculateDamage({
      baseDamage: 10,
      armor: 0,
      counterMultiplier: 1.3,
      skillMultiplier: 2,
      statusMultiplier: 2,
      structureMultiplier: 2,
    })).toBe(23);
    expect(calculateDamage({ baseDamage: 1, armor: 1_000_000 })).toBe(1);
  });

  it("rejects malformed authoritative inputs", () => {
    expect(() => calculateDamage({ baseDamage: 0, armor: 0 })).toThrow(RangeError);
    expect(() => calculateDamage({ baseDamage: 10, armor: -1 })).toThrow(RangeError);
    expect(() => calculateDamage({ baseDamage: 10, armor: 0, counterMultiplier: 1.31 })).toThrow(RangeError);
    expect(() => calculateDamage({ baseDamage: 10, armor: 0, armorIgnore: Number.NaN })).toThrow(RangeError);
  });

  it("uses the declared matrix directly for a matchup", () => {
    const attacker: CombatUnitId = "heavyCrossbowman";
    const defender: CombatUnitId = "boarRider";
    expect(calculateDamage({
      baseDamage: COMBAT_UNITS[attacker].baseDamage,
      armor: COMBAT_UNITS[defender].armor,
      counterMultiplier: COUNTER_MATRIX[attacker][defender],
    })).toBe(43);
  });
});

describe("six-direction facing", () => {
  it.each<[number, number, Facing]>([
    [1, 0, "e"],
    [1, -2, "ne"],
    [-1, -2, "nw"],
    [-1, 0, "w"],
    [-1, 2, "sw"],
    [1, 2, "se"],
  ])("quantizes (%s, %s) to %s", (dx, dy, expected) => {
    expect(quantizeFacing(dx, dy)).toBe(expected);
  });

  it("defaults a zero vector to southeast and otherwise retains prior facing", () => {
    expect(quantizeFacing(0, 0)).toBe("se");
    expect(quantizeFacing(0, 0, "nw")).toBe("nw");
  });

  it("uses a five-degree hysteresis band at sector boundaries", () => {
    const angle = 31 * Math.PI / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    expect(quantizeFacing(dx, dy)).toBe("se");
    expect(quantizeFacing(dx, dy, "e")).toBe("e");
  });

  it("publishes all six specification directions exactly once", () => {
    expect(FACING_DIRECTIONS).toEqual(["e", "ne", "nw", "w", "sw", "se"]);
    expect(new Set(FACING_DIRECTIONS).size).toBe(6);
    expect(() => quantizeFacing(Number.NaN, 0)).toThrow(RangeError);
  });
});
