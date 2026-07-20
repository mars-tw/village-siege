export const COMBAT_UNIT_IDS = [
  "warrior",
  "shieldBearer",
  "archer",
  "mage",
  "musketeer",
  "boarRider",
  "heavyCrossbowman",
] as const;

export const MONSTER_IDS = ["miremaw", "ashwing", "rootback"] as const;
export const FACING_DIRECTIONS = ["e", "ne", "nw", "w", "sw", "se"] as const;
export const ANIMATION_STATES = ["idle", "walk", "attack", "hurt", "death", "cast"] as const;
export const STATUS_EFFECT_IDS = [
  "armorBreak",
  "slow",
  "burn",
  "stagger",
  "tenacity",
  "shieldWall",
  "braced",
  "emplaced",
] as const;
export const PROJECTILE_PROFILE_IDS = [
  "arrow",
  "pinningVolley",
  "arcaneCinder",
  "musketTrace",
  "heavyBolt",
  "breachingBolt",
] as const;

export type CombatUnitId = (typeof COMBAT_UNIT_IDS)[number];
export type MonsterId = (typeof MONSTER_IDS)[number];
export type Facing = (typeof FACING_DIRECTIONS)[number];
export type AnimationState = (typeof ANIMATION_STATES)[number];
export type StatusEffectId = (typeof STATUS_EFFECT_IDS)[number];
export type ProjectileProfileId = (typeof PROJECTILE_PROFILE_IDS)[number];

export type ArmorClass = "heavy" | "guard" | "light" | "cloth" | "mounted" | "siegeCrew";
export type MonsterArmorClass = "beast" | "monster" | "fortified";
export type DamageType = "slash" | "impact" | "pierce" | "arcane" | "shot" | "charge" | "siegePierce";
export type AbilityPhase = "windup" | "commit" | "recovery" | "ready";
export type AbilityTargeting = "self" | "unit" | "ground" | "direction";
export type AbilityTargetFilter = "enemies" | "allPlayers";
export type StatusStackingRule = "refresh" | "replace" | "immuneWindow" | "state";
export type ProjectileKind = "locked" | "hitscan" | "line" | "groundArea";

export interface ResourceCost {
  readonly food: number;
  readonly wood: number;
  readonly stone: number;
}

export interface AbilityDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly cooldownMs: number;
  readonly windupMs: number;
  readonly recoveryMs: number;
  readonly targeting: AbilityTargeting;
  readonly targetFilter: AbilityTargetFilter;
  readonly description: string;
  readonly statusEffects: readonly StatusEffectId[];
  readonly damageMultiplier?: number;
  readonly projectileProfileId?: ProjectileProfileId;
}

export interface PassiveDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
}

export interface StatusEffectDefinition {
  readonly id: StatusEffectId;
  readonly displayName: string;
  readonly durationMs: number;
  readonly stacking: StatusStackingRule;
  readonly maxStacks: number;
  readonly magnitude: number;
  readonly tickIntervalMs?: number;
  readonly grantsStatusId?: StatusEffectId;
}

export interface ProjectileProfileDefinition {
  readonly id: ProjectileProfileId;
  readonly kind: ProjectileKind;
  readonly speedTilesPerSecond: number | null;
  readonly minTravelMs: number;
  readonly maxTargets: number;
  readonly friendlyFire: false;
  readonly blockedByTerrain: boolean;
  readonly visualKey: string;
  readonly impactEffectId: string;
}

export interface CombatUnitDefinition {
  readonly id: CombatUnitId;
  readonly displayName: string;
  readonly role: string;
  readonly maxHitPoints: number;
  readonly armorClass: ArmorClass;
  readonly armor: number;
  readonly damageType: DamageType;
  readonly baseDamage: number;
  readonly attackIntervalMs: number;
  readonly attackRange: number;
  readonly moveSpeed: number;
  readonly cost: ResourceCost;
  readonly population: number;
  readonly trainTimeMs: number;
  readonly activeAbility: AbilityDefinition;
  readonly passive: PassiveDefinition;
  readonly counterModifiers: Readonly<Record<CombatUnitId, number>>;
  readonly animationProfileId: string;
  readonly projectileProfileId?: ProjectileProfileId;
}

export interface MonsterRewardDefinition extends ResourceCost {
  readonly buffId?: string;
  readonly buffDurationMs?: number;
}

export interface MonsterDefinition {
  readonly id: MonsterId;
  readonly displayName: string;
  readonly role: string;
  readonly maxHitPoints: number;
  readonly armorClass: MonsterArmorClass;
  readonly armor: number;
  readonly damageType: DamageType;
  readonly baseDamage: number;
  readonly attackIntervalMs: number;
  readonly attackRange: number;
  readonly moveSpeed: number;
  readonly activeAbility: AbilityDefinition;
  readonly passive: PassiveDefinition;
  readonly animationProfileId: string;
  readonly projectileProfileId?: ProjectileProfileId;
  readonly reward: MonsterRewardDefinition;
}

export interface DamageInput {
  readonly baseDamage: number;
  readonly armor: number;
  readonly counterMultiplier?: number;
  readonly skillMultiplier?: number;
  readonly statusMultiplier?: number;
  readonly structureMultiplier?: number;
  readonly armorIgnore?: number;
  readonly armorBreak?: number;
}

export interface CombatDataValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const STATUS_EFFECTS = {
  armorBreak: { id: "armorBreak", displayName: "碎甲", durationMs: 5_000, stacking: "refresh", maxStacks: 1, magnitude: 10 },
  slow: { id: "slow", displayName: "緩速", durationMs: 2_500, stacking: "replace", maxStacks: 1, magnitude: 0.2 },
  burn: { id: "burn", displayName: "燃燒", durationMs: 3_000, stacking: "refresh", maxStacks: 1, magnitude: 5, tickIntervalMs: 1_000 },
  stagger: { id: "stagger", displayName: "踉蹌", durationMs: 800, stacking: "immuneWindow", maxStacks: 1, magnitude: 1, grantsStatusId: "tenacity" },
  tenacity: { id: "tenacity", displayName: "韌性", durationMs: 2_000, stacking: "refresh", maxStacks: 1, magnitude: 1 },
  shieldWall: { id: "shieldWall", displayName: "盾牆", durationMs: 4_000, stacking: "refresh", maxStacks: 1, magnitude: 0.45 },
  braced: { id: "braced", displayName: "架盾拒馬", durationMs: 0, stacking: "state", maxStacks: 1, magnitude: 0.6 },
  emplaced: { id: "emplaced", displayName: "架設", durationMs: 0, stacking: "state", maxStacks: 1, magnitude: 0.2 },
} as const satisfies Readonly<Record<StatusEffectId, StatusEffectDefinition>>;

export const PROJECTILE_PROFILES = {
  arrow: projectile("arrow", "locked", 11, 200, 1, false, "proj.arrow.flight", "fx.arrowHit"),
  pinningVolley: projectile("pinningVolley", "groundArea", 11, 200, 3, false, "proj.arrow.flight", "fx.arrowHit"),
  arcaneCinder: projectile("arcaneCinder", "locked", 8, 200, 1, false, "proj.arcaneCinder.flight", "fx.arcaneHit"),
  musketTrace: projectile("musketTrace", "hitscan", null, 0, 1, false, "proj.musketTrace.flight", "fx.musketHit"),
  heavyBolt: projectile("heavyBolt", "locked", 14, 200, 1, true, "proj.heavyBolt.flight", "fx.boltHit"),
  breachingBolt: projectile("breachingBolt", "line", 14, 100, 2, true, "proj.heavyBolt.flight", "fx.boltHit"),
} as const satisfies Readonly<Record<ProjectileProfileId, ProjectileProfileDefinition>>;

// Three draft rows are minimally normalized so formal REQ-003 is enforceable:
// every unit has at least two favorable and two unfavorable numeric matchups.
export const COUNTER_MATRIX = {
  warrior: matrix(1.00, 1.20, 0.90, 0.90, 1.15, 0.80, 1.25),
  shieldBearer: matrix(0.95, 1.00, 1.20, 0.75, 1.10, 1.25, 0.95),
  archer: matrix(0.85, 0.75, 1.00, 1.25, 1.15, 0.80, 1.15),
  mage: matrix(1.20, 1.30, 0.80, 1.00, 1.05, 0.85, 1.20),
  musketeer: matrix(1.25, 0.90, 0.90, 1.15, 1.00, 1.25, 1.10),
  boarRider: matrix(0.90, 0.75, 1.30, 1.30, 1.30, 1.00, 1.20),
  heavyCrossbowman: matrix(1.15, 1.20, 0.80, 0.85, 0.90, 1.30, 1.00),
} as const satisfies Readonly<Record<CombatUnitId, Readonly<Record<CombatUnitId, number>>>>;

export const COMBAT_UNITS = {
  warrior: unit({
    id: "warrior", displayName: "戰士", role: "持續近戰與破甲前排", maxHitPoints: 150, armorClass: "heavy", armor: 18,
    damageType: "slash", baseDamage: 22, attackIntervalMs: 1_100, attackRange: 1, moveSpeed: 1.05,
    cost: cost(65, 30, 0), population: 1, trainTimeMs: 16_000,
    activeAbility: ability("armorSunder", "碎甲擊", 12_000, 400, 600, "unit", "連同強擊施加 5 秒碎甲。", ["armorBreak"], 1.4),
    passive: passive("combatRhythm", "纏鬥節奏", "連續攻擊同一目標時逐步提高傷害，切換目標即清除。"),
    counterModifiers: COUNTER_MATRIX.warrior, animationProfileId: "unit.warrior",
  }),
  shieldBearer: unit({
    id: "shieldBearer", displayName: "盾牌手", role: "正面投射物掩護與反衝鋒", maxHitPoints: 230, armorClass: "guard", armor: 32,
    damageType: "impact", baseDamage: 14, attackIntervalMs: 1_400, attackRange: 1, moveSpeed: 0.82,
    cost: cost(75, 45, 20), population: 2, trainTimeMs: 22_000,
    activeAbility: ability("shieldWall", "盾牆", 18_000, 300, 500, "self", "四秒內降低正面 120 度的非奧術投射物傷害。", ["shieldWall"]),
    passive: passive("brace", "架盾拒馬", "靜止後可削弱正面衝鋒並使騎士踉蹌。"),
    counterModifiers: COUNTER_MATRIX.shieldBearer, animationProfileId: "unit.shieldBearer",
  }),
  archer: unit({
    id: "archer", displayName: "弓箭手", role: "機動遠程壓制與區域緩速", maxHitPoints: 85, armorClass: "light", armor: 6,
    damageType: "pierce", baseDamage: 18, attackIntervalMs: 1_300, attackRange: 7, moveSpeed: 1.1,
    cost: cost(45, 55, 0), population: 1, trainTimeMs: 18_000,
    activeAbility: ability("pinningVolley", "釘地箭雨", 16_000, 600, 500, "ground", "向小範圍射出三箭並緩速首次命中的敵人。", ["slow"], 0.55, "pinningVolley"),
    passive: passive("gapHunter", "獵隙", "擅長壓制布甲與已架設的攻城組。"),
    counterModifiers: COUNTER_MATRIX.archer, animationProfileId: "unit.archer", projectileProfileId: "arrow",
  }),
  mage: unit({
    id: "mage", displayName: "法師", role: "忽略護甲的範圍壓力", maxHitPoints: 75, armorClass: "cloth", armor: 2,
    damageType: "arcane", baseDamage: 30, attackIntervalMs: 1_800, attackRange: 6, moveSpeed: 0.92,
    cost: cost(75, 30, 60), population: 2, trainTimeMs: 26_000,
    activeAbility: ability("emberSigil", "餘燼法印", 18_000, 800, 700, "ground", "在地面法印造成 32 點奧術傷害並附加燃燒。", ["burn"], 32 / 30),
    passive: passive("arcaneAttunement", "奧術調諧", "奧術傷害忽略目標 35% 護甲。"),
    counterModifiers: COUNTER_MATRIX.mage, animationProfileId: "unit.mage", projectileProfileId: "arcaneCinder",
  }),
  musketeer: unit({
    id: "musketeer", displayName: "火槍兵", role: "長前搖高單發穿甲", maxHitPoints: 95, armorClass: "light", armor: 10,
    damageType: "shot", baseDamage: 46, attackIntervalMs: 2_500, attackRange: 8, moveSpeed: 0.88,
    cost: cost(60, 70, 35), population: 2, trainTimeMs: 25_000,
    activeAbility: ability("aimedShot", "定裝瞄擊", 15_000, 1_000, 900, "unit", "長前搖瞄準後造成 160% 傷害並忽略 60% 護甲。", [], 1.6, "musketTrace"),
    passive: passive("matchlockRest", "穩架火繩", "原地架槍後提高下一次射擊的射程並縮短 recovery。"),
    counterModifiers: COUNTER_MATRIX.musketeer, animationProfileId: "unit.musketeer", projectileProfileId: "musketTrace",
  }),
  boarRider: unit({
    id: "boarRider", displayName: "野豬騎士", role: "高速突進與後排干擾", maxHitPoints: 210, armorClass: "mounted", armor: 16,
    damageType: "charge", baseDamage: 30, attackIntervalMs: 1_300, attackRange: 1, moveSpeed: 1.75,
    cost: cost(115, 35, 20), population: 2, trainTimeMs: 28_000,
    activeAbility: ability("tuskCharge", "獠牙衝陣", 14_000, 300, 700, "direction", "沿 3–6 格直線衝鋒，傷害並踉蹌首個敵人。", ["stagger"], 1.6),
    passive: passive("momentum", "奔勢", "持續移動三格後強化下一次基本攻擊。"),
    counterModifiers: COUNTER_MATRIX.boarRider, animationProfileId: "unit.boarRider",
  }),
  heavyCrossbowman: unit({
    id: "heavyCrossbowman", displayName: "重弩手", role: "遠程攻城與反騎乘架設火力", maxHitPoints: 115, armorClass: "siegeCrew", armor: 12,
    damageType: "siegePierce", baseDamage: 38, attackIntervalMs: 2_800, attackRange: 9, moveSpeed: 0.68,
    cost: cost(50, 110, 50), population: 3, trainTimeMs: 32_000,
    activeAbility: ability("breachingBolt", "破城貫矢", 20_000, 1_200, 1_000, "direction", "線型巨矢最多穿透兩個敵人，命中建築即停止。", [], 1.6, "breachingBolt"),
    passive: passive("emplacement", "落架校準", "原地兩秒後取得額外射程與對建築傷害。"),
    counterModifiers: COUNTER_MATRIX.heavyCrossbowman, animationProfileId: "unit.heavyCrossbowman", projectileProfileId: "heavyBolt",
  }),
} as const satisfies Readonly<Record<CombatUnitId, CombatUnitDefinition>>;

export const MONSTERS = {
  miremaw: monster({
    id: "miremaw", displayName: "沼牙獸", role: "低伏包抄與緩速伏擊", maxHitPoints: 340, armorClass: "beast", armor: 12,
    damageType: "slash", baseDamage: 22, attackIntervalMs: 1_200, attackRange: 1, moveSpeed: 1.45,
    activeAbility: monsterAbility("mireAmbush", "泥沼伏擊", 12_000, 600, 600, "ground", "潛伏後躍出，傷害範圍內所有玩家並緩速。", ["slow"], 1.2),
    passive: passive("reedCamouflage", "蘆囊伏色", "未戰鬥時縮低輪廓，首次索敵取得短暫加速。"),
    animationProfileId: "monster.miremaw", reward: reward(120, 60, 0, "scoutingRations", 45_000),
  }),
  ashwing: monster({
    id: "ashwing", displayName: "燼翼獵獸", role: "越過前排俯衝後排", maxHitPoints: 520, armorClass: "monster", armor: 16,
    damageType: "slash", baseDamage: 32, attackIntervalMs: 1_600, attackRange: 1, moveSpeed: 1.55,
    activeAbility: monsterAbility("ashDive", "燼翼俯衝", 14_000, 800, 800, "ground", "躍過前排並俯衝指定區域，踉蹌所有玩家單位。", ["stagger"], 1.4),
    passive: passive("rearLineHunter", "後排獵性", "優先鎖定射程較長且生命較低的玩家單位。"),
    animationProfileId: "monster.ashwing", reward: reward(150, 80, 30, "ashwingDraft", 60_000),
  }),
  rootback: monster({
    id: "rootback", displayName: "根背巨像", role: "中央首領與建築破壞", maxHitPoints: 1_800, armorClass: "fortified", armor: 35,
    damageType: "impact", baseDamage: 42, attackIntervalMs: 2_200, attackRange: 1.5, moveSpeed: 0.62,
    activeAbility: monsterAbility("rootbackSlam", "裂地重擊", 12_000, 1_000, 1_000, "ground", "舉起長臂後重擊地面，傷害並踉蹌範圍內所有玩家。", ["stagger"], 1.5),
    passive: passive("shaleBulwark", "頁岩壁壘", "40% 生命以下進入狂怒，但仍受奧術破甲。"),
    animationProfileId: "monster.rootback", reward: reward(220, 220, 220, "cinderStandard", 90_000),
  }),
} as const satisfies Readonly<Record<MonsterId, MonsterDefinition>>;

/** Deterministic authoritative damage. Multipliers are capped before armor. */
export function calculateDamage(input: DamageInput): number {
  requireSafeInteger(input.baseDamage, "baseDamage", 1);
  requireSafeInteger(input.armor, "armor", 0);
  const counter = input.counterMultiplier ?? 1;
  const skill = input.skillMultiplier ?? 1;
  const status = input.statusMultiplier ?? 1;
  const structure = input.structureMultiplier ?? 1;
  const armorIgnore = input.armorIgnore ?? 0;
  const armorBreak = input.armorBreak ?? 0;

  requireMultiplier(counter, "counterMultiplier", 0.75, 1.3);
  requireMultiplier(skill, "skillMultiplier");
  requireMultiplier(status, "statusMultiplier");
  requireMultiplier(structure, "structureMultiplier");
  requireFiniteRange(armorIgnore, "armorIgnore", 0, 1);
  requireSafeInteger(armorBreak, "armorBreak", 0);

  const effectiveArmor = Math.max(0, input.armor * (1 - armorIgnore) - armorBreak);
  const combinedMultiplier = Math.min(2.25, counter * skill * status * structure);
  const result = Math.max(1, Math.round(input.baseDamage * combinedMultiplier * 100 / (100 + effectiveArmor)));
  if (!Number.isSafeInteger(result)) throw new RangeError("calculated damage exceeds the safe integer range");
  return result;
}

/**
 * Quantizes a screen-space vector (positive y points down) to six facings.
 * A five-degree hysteresis band retains the previous facing near a boundary.
 */
export function quantizeFacing(dx: number, dy: number, previousFacing?: Facing): Facing {
  requireFinite(dx, "dx");
  requireFinite(dy, "dy");
  if (Math.hypot(dx, dy) <= Number.EPSILON) return previousFacing ?? "se";

  const angle = normalizeRadians(Math.atan2(dy, dx));
  if (previousFacing !== undefined) {
    const previousCenter = FACING_CENTERS[previousFacing];
    if (angularDistance(angle, previousCenter) <= 35 * Math.PI / 180) return previousFacing;
  }

  const clockwiseFacings = ["e", "se", "sw", "w", "nw", "ne"] as const;
  const sector = Math.floor((angle + Math.PI / 6) / (Math.PI / 3)) % clockwiseFacings.length;
  return clockwiseFacings[sector]!;
}

export function validateCombatData(): CombatDataValidationResult {
  const errors: string[] = [];
  validateExactRegistry("combat unit", COMBAT_UNIT_IDS, COMBAT_UNITS, errors);
  validateExactRegistry("monster", MONSTER_IDS, MONSTERS, errors);
  validateExactRegistry("status", STATUS_EFFECT_IDS, STATUS_EFFECTS, errors);
  validateExactRegistry("projectile", PROJECTILE_PROFILE_IDS, PROJECTILE_PROFILES, errors);
  validateUniqueValues("facing", FACING_DIRECTIONS, errors);

  const abilityIds = new Set<string>();
  for (const unitId of COMBAT_UNIT_IDS) {
    const definition = COMBAT_UNITS[unitId];
    validateActor(definition, `unit.${unitId}`, errors);
    validateCost(definition.cost, `unit.${unitId}.cost`, errors);
    validatePositiveSafeInteger(definition.population, `unit.${unitId}.population`, errors);
    validateTickDuration(definition.trainTimeMs, `unit.${unitId}.trainTimeMs`, errors, false);
    validateAbility(definition.activeAbility, `unit.${unitId}.activeAbility`, abilityIds, errors);
    validatePassive(definition.passive, `unit.${unitId}.passive`, errors);
    validateProjectileReference(definition.projectileProfileId, `unit.${unitId}.projectileProfileId`, errors);

    const targets = Object.keys(definition.counterModifiers);
    if (!sameMembers(targets, COMBAT_UNIT_IDS)) errors.push(`unit.${unitId}.counterModifiers must cover every combat unit exactly once`);
    let favorable = 0;
    let unfavorable = 0;
    for (const targetId of COMBAT_UNIT_IDS) {
      const multiplier = definition.counterModifiers[targetId];
      if (!Number.isFinite(multiplier) || multiplier < 0.75 || multiplier > 1.3) {
        errors.push(`counter ${unitId}->${targetId} must be within 0.75..1.30`);
      }
      if (multiplier > 1) favorable += 1;
      if (multiplier < 1) unfavorable += 1;
    }
    if (definition.counterModifiers[unitId] !== 1) errors.push(`counter ${unitId}->${unitId} must be 1.00`);
    if (favorable < 2) errors.push(`unit.${unitId} must have at least two favorable matchups`);
    if (unfavorable < 2) errors.push(`unit.${unitId} must have at least two unfavorable matchups`);
  }

  for (const monsterId of MONSTER_IDS) {
    const definition = MONSTERS[monsterId];
    validateActor(definition, `monster.${monsterId}`, errors);
    validateAbility(definition.activeAbility, `monster.${monsterId}.activeAbility`, abilityIds, errors);
    validatePassive(definition.passive, `monster.${monsterId}.passive`, errors);
    validateProjectileReference(definition.projectileProfileId, `monster.${monsterId}.projectileProfileId`, errors);
    validateCost(definition.reward, `monster.${monsterId}.reward`, errors);
    if (definition.reward.buffDurationMs !== undefined) validateTickDuration(definition.reward.buffDurationMs, `monster.${monsterId}.reward.buffDurationMs`, errors, false);
  }

  for (const statusId of STATUS_EFFECT_IDS) {
    const status: StatusEffectDefinition = STATUS_EFFECTS[statusId];
    if (status.id !== statusId) errors.push(`status.${statusId}.id must match its registry key`);
    validateTickDuration(status.durationMs, `status.${statusId}.durationMs`, errors, true);
    validatePositiveSafeInteger(status.maxStacks, `status.${statusId}.maxStacks`, errors);
    if (!Number.isFinite(status.magnitude) || status.magnitude < 0) errors.push(`status.${statusId}.magnitude must be finite and non-negative`);
    if (status.tickIntervalMs !== undefined) validateTickDuration(status.tickIntervalMs, `status.${statusId}.tickIntervalMs`, errors, false);
    if (status.grantsStatusId !== undefined && !STATUS_EFFECT_IDS.includes(status.grantsStatusId)) errors.push(`status.${statusId}.grantsStatusId is unknown`);
  }

  for (const projectileId of PROJECTILE_PROFILE_IDS) {
    const profile = PROJECTILE_PROFILES[projectileId];
    if (profile.id !== projectileId) errors.push(`projectile.${projectileId}.id must match its registry key`);
    if (profile.kind === "hitscan") {
      if (profile.speedTilesPerSecond !== null || profile.minTravelMs !== 0) errors.push(`hitscan projectile.${projectileId} must have null speed and zero travel time`);
    } else if (profile.speedTilesPerSecond === null || !Number.isFinite(profile.speedTilesPerSecond) || profile.speedTilesPerSecond <= 0) {
      errors.push(`projectile.${projectileId} must have positive travel speed`);
    }
    validateTickDuration(profile.minTravelMs, `projectile.${projectileId}.minTravelMs`, errors, true);
    validatePositiveSafeInteger(profile.maxTargets, `projectile.${projectileId}.maxTargets`, errors);
    if (profile.friendlyFire !== false) errors.push(`projectile.${projectileId} must disable friendly fire`);
    if (profile.visualKey.length === 0 || profile.impactEffectId.length === 0) errors.push(`projectile.${projectileId} requires visual and impact keys`);
  }

  return { ok: errors.length === 0, errors };
}

const FACING_CENTERS: Readonly<Record<Facing, number>> = {
  e: 0,
  se: Math.PI / 3,
  sw: 2 * Math.PI / 3,
  w: Math.PI,
  nw: 4 * Math.PI / 3,
  ne: 5 * Math.PI / 3,
};

function projectile(
  id: ProjectileProfileId,
  kind: ProjectileKind,
  speedTilesPerSecond: number | null,
  minTravelMs: number,
  maxTargets: number,
  blockedByTerrain: boolean,
  visualKey: string,
  impactEffectId: string,
): ProjectileProfileDefinition {
  return { id, kind, speedTilesPerSecond, minTravelMs, maxTargets, friendlyFire: false, blockedByTerrain, visualKey, impactEffectId };
}

function matrix(
  warrior: number,
  shieldBearer: number,
  archer: number,
  mage: number,
  musketeer: number,
  boarRider: number,
  heavyCrossbowman: number,
): Readonly<Record<CombatUnitId, number>> {
  return { warrior, shieldBearer, archer, mage, musketeer, boarRider, heavyCrossbowman };
}

function cost(food: number, wood: number, stone: number): ResourceCost {
  return { food, wood, stone };
}

function reward(food: number, wood: number, stone: number, buffId?: string, buffDurationMs?: number): MonsterRewardDefinition {
  return { food, wood, stone, buffId, buffDurationMs };
}

function ability(
  id: string,
  displayName: string,
  cooldownMs: number,
  windupMs: number,
  recoveryMs: number,
  targeting: AbilityTargeting,
  description: string,
  statusEffects: readonly StatusEffectId[],
  damageMultiplier?: number,
  projectileProfileId?: ProjectileProfileId,
): AbilityDefinition {
  return { id, displayName, cooldownMs, windupMs, recoveryMs, targeting, targetFilter: "enemies", description, statusEffects, damageMultiplier, projectileProfileId };
}

function monsterAbility(
  id: string,
  displayName: string,
  cooldownMs: number,
  windupMs: number,
  recoveryMs: number,
  targeting: AbilityTargeting,
  description: string,
  statusEffects: readonly StatusEffectId[],
  damageMultiplier: number,
): AbilityDefinition {
  return { id, displayName, cooldownMs, windupMs, recoveryMs, targeting, targetFilter: "allPlayers", description, statusEffects, damageMultiplier };
}

function passive(id: string, displayName: string, description: string): PassiveDefinition {
  return { id, displayName, description };
}

function unit(definition: CombatUnitDefinition): CombatUnitDefinition {
  return definition;
}

function monster(definition: MonsterDefinition): MonsterDefinition {
  return definition;
}

function validateActor(
  definition: Pick<CombatUnitDefinition, "id" | "displayName" | "role" | "maxHitPoints" | "armor" | "baseDamage" | "attackIntervalMs" | "attackRange" | "moveSpeed" | "animationProfileId"> | Pick<MonsterDefinition, "id" | "displayName" | "role" | "maxHitPoints" | "armor" | "baseDamage" | "attackIntervalMs" | "attackRange" | "moveSpeed" | "animationProfileId">,
  path: string,
  errors: string[],
): void {
  if (definition.displayName.length === 0 || definition.role.length === 0) errors.push(`${path} requires displayName and role`);
  validatePositiveSafeInteger(definition.maxHitPoints, `${path}.maxHitPoints`, errors);
  validateNonNegativeSafeInteger(definition.armor, `${path}.armor`, errors);
  validatePositiveSafeInteger(definition.baseDamage, `${path}.baseDamage`, errors);
  validateTickDuration(definition.attackIntervalMs, `${path}.attackIntervalMs`, errors, false);
  if (!Number.isFinite(definition.attackRange) || definition.attackRange <= 0) errors.push(`${path}.attackRange must be positive and finite`);
  if (!Number.isFinite(definition.moveSpeed) || definition.moveSpeed <= 0) errors.push(`${path}.moveSpeed must be positive and finite`);
  if (definition.animationProfileId.length === 0) errors.push(`${path}.animationProfileId is required`);
}

function validateAbility(definition: AbilityDefinition, path: string, abilityIds: Set<string>, errors: string[]): void {
  if (definition.id.length === 0 || abilityIds.has(definition.id)) errors.push(`${path}.id must be non-empty and globally unique`);
  abilityIds.add(definition.id);
  if (definition.displayName.length === 0 || definition.description.length === 0) errors.push(`${path} requires displayName and description`);
  validateTickDuration(definition.cooldownMs, `${path}.cooldownMs`, errors, false);
  validateTickDuration(definition.windupMs, `${path}.windupMs`, errors, true);
  validateTickDuration(definition.recoveryMs, `${path}.recoveryMs`, errors, true);
  if (definition.damageMultiplier !== undefined && (!Number.isFinite(definition.damageMultiplier) || definition.damageMultiplier <= 0 || definition.damageMultiplier > 2.25)) {
    errors.push(`${path}.damageMultiplier must be within 0..2.25`);
  }
  for (const statusId of definition.statusEffects) {
    if (!STATUS_EFFECT_IDS.includes(statusId)) errors.push(`${path} references unknown status ${statusId}`);
  }
  validateProjectileReference(definition.projectileProfileId, `${path}.projectileProfileId`, errors);
}

function validatePassive(definition: PassiveDefinition, path: string, errors: string[]): void {
  if (definition.id.length === 0 || definition.displayName.length === 0 || definition.description.length === 0) errors.push(`${path} is incomplete`);
}

function validateProjectileReference(id: ProjectileProfileId | undefined, path: string, errors: string[]): void {
  if (id !== undefined && !PROJECTILE_PROFILE_IDS.includes(id)) errors.push(`${path} references unknown projectile ${id}`);
}

function validateCost(value: ResourceCost, path: string, errors: string[]): void {
  validateNonNegativeSafeInteger(value.food, `${path}.food`, errors);
  validateNonNegativeSafeInteger(value.wood, `${path}.wood`, errors);
  validateNonNegativeSafeInteger(value.stone, `${path}.stone`, errors);
}

function validateExactRegistry(
  label: string,
  expected: readonly string[],
  registry: Readonly<Record<string, unknown>>,
  errors: string[],
): void {
  const actual = Object.keys(registry);
  if (!sameMembers(actual, expected)) errors.push(`${label} registry must contain exactly: ${expected.join(", ")}`);
  validateUniqueValues(`${label} id`, expected, errors);
  for (const id of expected) {
    const candidate = registry[id];
    if (typeof candidate !== "object" || candidate === null || !("id" in candidate) || candidate.id !== id) errors.push(`${label}.${id}.id must match its registry key`);
  }
}

function validateUniqueValues(label: string, values: readonly string[], errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${label} values must be unique`);
}

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function validateTickDuration(value: number, path: string, errors: string[], allowZero: boolean): void {
  const minimum = allowZero ? 0 : 100;
  if (!Number.isSafeInteger(value) || value < minimum || value % 100 !== 0) errors.push(`${path} must be an integer multiple of 100ms`);
}

function validatePositiveSafeInteger(value: number, path: string, errors: string[]): void {
  if (!Number.isSafeInteger(value) || value <= 0) errors.push(`${path} must be a positive safe integer`);
}

function validateNonNegativeSafeInteger(value: number, path: string, errors: string[]): void {
  if (!Number.isSafeInteger(value) || value < 0) errors.push(`${path} must be a non-negative safe integer`);
}

function requireSafeInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
}

function requireMultiplier(value: number, name: string, minimum = Number.MIN_VALUE, maximum = Number.MAX_VALUE): void {
  requireFiniteRange(value, name, minimum, maximum);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function requireFiniteRange(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be within ${minimum}..${maximum}`);
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function normalizeRadians(value: number): number {
  const fullCircle = 2 * Math.PI;
  return (value % fullCircle + fullCircle) % fullCircle;
}

function angularDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 2 * Math.PI - direct);
}
