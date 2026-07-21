import {
  getBuildingFootprint,
  getFootprintCells,
  type BuildingType,
  type Facing,
  type GridPoint,
  type MonsterId,
  type PublicEntityState,
  type ResourceCargo,
  type ResourceKind,
  type StructureOrientation,
  type UnitType,
} from "@village-siege/shared";

export type PublicUnitEntity = PublicEntityState & {
  readonly kind: "unit";
  readonly ownerId: string;
  readonly typeId: UnitType;
  readonly facing?: Facing;
  readonly cargo?: ResourceCargo;
};

export type PublicBuildingEntity = PublicEntityState & {
  readonly kind: "building";
  readonly ownerId: string;
  readonly typeId: BuildingType;
  readonly orientation?: StructureOrientation;
  readonly complete?: boolean;
  readonly constructionRemainingTicks?: number;
  readonly gateOpen?: boolean;
};

export type PublicResourceEntity = PublicEntityState & {
  readonly kind: "resource";
  readonly ownerId: null;
  readonly typeId: ResourceKind;
};

export type PublicRubbleEntity = PublicEntityState & {
  readonly kind: "rubble";
  readonly ownerId: null;
  readonly typeId: BuildingType;
  readonly orientation?: StructureOrientation;
};

export type PublicMonsterEntity = PublicEntityState & {
  readonly kind: "monster";
  readonly ownerId: null;
  readonly typeId: MonsterId;
  readonly facing?: Facing;
};

export function isPublicUnit(entity: PublicEntityState): entity is PublicUnitEntity {
  return entity.kind === "unit" && entity.ownerId !== null;
}

export function isPublicBuilding(entity: PublicEntityState): entity is PublicBuildingEntity {
  return entity.kind === "building" && entity.ownerId !== null;
}

export function isPublicResource(entity: PublicEntityState): entity is PublicResourceEntity {
  return entity.kind === "resource" && entity.ownerId === null;
}

export function isPublicRubble(entity: PublicEntityState): entity is PublicRubbleEntity {
  return entity.kind === "rubble" && entity.ownerId === null;
}

export function isPublicMonster(entity: PublicEntityState): entity is PublicMonsterEntity {
  return entity.kind === "monster" && entity.ownerId === null;
}

export function publicEntityFootprintCells(entity: PublicEntityState): readonly GridPoint[] {
  if (isPublicBuilding(entity) || isPublicRubble(entity)) {
    return getFootprintCells(
      entity.position,
      getBuildingFootprint(entity.typeId, entity.orientation ?? "ne"),
    );
  }
  return [{ ...entity.position }];
}

export function publicResourceAmount(entity: PublicResourceEntity): number {
  return entity.resourceNode?.amount ?? Math.max(0, entity.hitPoints);
}

export function publicResourceRenewAtTick(entity: PublicResourceEntity): number | null {
  return entity.resourceNode?.renewAtTick ?? null;
}

export function publicUnitCargo(entity: PublicUnitEntity): ResourceCargo {
  return entity.cargo ?? { kind: null, amount: 0, capacity: 0 };
}

export function publicFacing(entity: PublicUnitEntity | PublicMonsterEntity, fallback: Facing): Facing {
  return entity.facing ?? fallback;
}

export function publicMonsterAttackCooldown(entity: PublicMonsterEntity): number {
  return entity.monsterState?.attackCooldownTicks ?? 0;
}

export function publicPlayerHomePosition(
  entities: readonly PublicEntityState[],
  playerId: string,
): GridPoint | null {
  const ownedBuildings = entities.filter((entity): entity is PublicBuildingEntity => (
    isPublicBuilding(entity) && entity.ownerId === playerId
  ));
  const home = ownedBuildings.find((entity) => entity.typeId === "townCenter")
    ?? ownedBuildings[0]
    ?? entities.find((entity) => isPublicUnit(entity) && entity.ownerId === playerId);
  return home ? { ...home.position } : null;
}
