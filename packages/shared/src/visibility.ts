import { BUILDINGS, UNITS, getBuildingFootprint } from "./content.js";
import { getFootprintCells } from "./spatial.js";
import { doesEntityBlockMovement, getStructureHealthBand, type BuildingEntityState, type EntityState, type MatchState, type UnitEntityState } from "./simulation.js";
import type { GridPoint, PlayerId, StaleEntitySighting } from "./protocol.js";

export interface PlayerVisibilityState {
  playerId: PlayerId;
  visibleTileIndices: number[];
  exploredTileIndices: number[];
  staleEnemySightings: StaleEntitySighting[];
  observerRevision: string;
  sightingRevision: string;
  revision: number;
}

const CIRCLE_OFFSETS = new Map<number, readonly GridPoint[]>();

export function createPlayerVisibilityStates(playerIds: readonly PlayerId[]): PlayerVisibilityState[] {
  return [...playerIds]
    .sort(compareText)
    .map((playerId) => ({
      playerId,
      visibleTileIndices: [],
      exploredTileIndices: [],
      staleEnemySightings: [],
      observerRevision: "",
      sightingRevision: "",
      revision: 0,
    }));
}

export function updateVisibilityState(state: MatchState): void {
  const knownPlayers = new Set(state.players.map((player) => player.id));
  state.visibilityByPlayer = state.visibilityByPlayer
    .filter((entry) => knownPlayers.has(entry.playerId))
    .sort((left, right) => compareText(left.playerId, right.playerId));
  for (const player of [...state.players].sort((left, right) => compareText(left.id, right.id))) {
    let visibility = state.visibilityByPlayer.find((entry) => entry.playerId === player.id);
    if (!visibility) {
      visibility = {
        playerId: player.id,
        visibleTileIndices: [],
        exploredTileIndices: [],
        staleEnemySightings: [],
        observerRevision: "",
        sightingRevision: "",
        revision: 0,
      };
      state.visibilityByPlayer.push(visibility);
      state.visibilityByPlayer.sort((left, right) => compareText(left.playerId, right.playerId));
    }

    const observerRevision = computeObserverRevision(state, player.id);
    const visibleTileIndices = observerRevision === visibility.observerRevision
      ? visibility.visibleTileIndices
      : computeVisibleTileIndices(state, player.id);
    const visibleSet = new Set(visibleTileIndices);
    const exploredTileIndices = observerRevision === visibility.observerRevision
      ? visibility.exploredTileIndices
      : [...new Set([...visibility.exploredTileIndices, ...visibleTileIndices])].sort(compareNumber);
    const hostileVisibleBuildings = state.entities
      .filter((entity): entity is BuildingEntityState => (
        entity.kind === "building"
        && entity.ownerId !== player.id
        && arePlayersHostile(state, player.id, entity.ownerId)
        && entityFootprintVisible(entity, visibleSet, state.map.width)
      ))
      .sort((left, right) => compareText(left.id, right.id));
    const sightingRevision = hostileVisibleBuildings
      .map((building) => `${building.id}:${building.position.x}:${building.position.y}:${building.hitPoints}:${building.maxHitPoints}:${building.stateRevision}:${building.orientation}:${building.gateOpen ? 1 : 0}`)
      .join("|");
    if (observerRevision === visibility.observerRevision && sightingRevision === visibility.sightingRevision) {
      const visibleIds = new Set(hostileVisibleBuildings.map((building) => building.id));
      visibility.staleEnemySightings = visibility.staleEnemySightings.map((sighting) => (
        visibleIds.has(sighting.entityId) ? { ...cloneSighting(sighting), observedAtTick: state.tick } : sighting
      ));
      continue;
    }
    const visibleBuildingIds = new Set(hostileVisibleBuildings.map((building) => building.id));
    const staleById = new Map<string, StaleEntitySighting>();

    for (const sighting of visibility.staleEnemySightings) {
      const sightingCells = getFootprintCells(sighting.position, getBuildingFootprint(sighting.typeId, sighting.orientation));
      if (sightingCells.some((cell) => visibleSet.has(tileIndex(cell, state.map.width))) && !visibleBuildingIds.has(sighting.entityId)) continue;
      staleById.set(sighting.entityId, cloneSighting(sighting));
    }
    for (const building of hostileVisibleBuildings) {
      staleById.set(building.id, {
        entityId: building.id,
        ownerId: building.ownerId,
        typeId: building.typeId,
        position: { ...building.position },
        hitPoints: building.hitPoints,
        maxHitPoints: building.maxHitPoints,
        stateRevision: building.stateRevision,
        orientation: building.orientation,
        gateOpen: building.typeId === "surveyGate" ? building.gateOpen : undefined,
        complete: building.complete,
        constructionRemainingTicks: building.constructionRemainingTicks,
        healthBand: getStructureHealthBand(building),
        blocksMovement: doesEntityBlockMovement(building),
        observedAtTick: state.tick,
      });
    }

    visibility.visibleTileIndices = visibleTileIndices;
    visibility.exploredTileIndices = exploredTileIndices;
    visibility.staleEnemySightings = [...staleById.values()].sort((left, right) => compareText(left.entityId, right.entityId));
    visibility.observerRevision = observerRevision;
    visibility.sightingRevision = sightingRevision;
    visibility.revision += 1;
  }
}

export function getPlayerVisibilityState(state: MatchState, playerId: PlayerId): PlayerVisibilityState {
  const visibility = state.visibilityByPlayer.find((entry) => entry.playerId === playerId);
  if (!visibility) throw new Error(`Unknown visibility recipient: ${playerId}`);
  return visibility;
}

export function isTileVisibleToPlayer(state: MatchState, playerId: PlayerId, point: GridPoint): boolean {
  if (!isPointInBounds(point, state.map.width, state.map.height)) return false;
  return getPlayerVisibilityState(state, playerId).visibleTileIndices.includes(tileIndex(point, state.map.width));
}

export function isTileExploredByPlayer(state: MatchState, playerId: PlayerId, point: GridPoint): boolean {
  if (!isPointInBounds(point, state.map.width, state.map.height)) return false;
  return getPlayerVisibilityState(state, playerId).exploredTileIndices.includes(tileIndex(point, state.map.width));
}

export function isEntityVisibleToPlayerFromFog(state: MatchState, playerId: PlayerId, target: EntityState): boolean {
  if (target.ownerId !== null && arePlayersAllied(state, playerId, target.ownerId)) return true;
  const teamId = state.players.find((player) => player.id === playerId)?.teamId;
  if (!teamId) throw new Error(`Unknown visibility recipient: ${playerId}`);
  const targetCells = target.kind === "building" || target.kind === "rubble"
    ? getFootprintCells(target.position, getBuildingFootprint(target.typeId, target.orientation))
    : [target.position];
  return state.entities.some((observer) => {
    if (observer.kind === "resource" || observer.kind === "rubble" || observer.kind === "monster" || observer.hitPoints <= 0) return false;
    if (observer.kind === "building" && !observer.complete) return false;
    if (state.players.find((player) => player.id === observer.ownerId)?.teamId !== teamId) return false;
    const radius = observer.kind === "unit" ? UNITS[observer.typeId].sightRadius : BUILDINGS[observer.typeId].sightRadius;
    const origins = observer.kind === "building"
      ? getFootprintCells(observer.position, getBuildingFootprint(observer.typeId, observer.orientation))
      : [observer.position];
    return origins.some((origin) => targetCells.some((cell) => {
      const dx = origin.x - cell.x;
      const dy = origin.y - cell.y;
      return dx * dx + dy * dy <= radius * radius;
    }));
  });
}

export function encodeExploredTilesRle(mapWidth: number, mapHeight: number, exploredTileIndices: readonly number[]): string {
  const explored = new Set(exploredTileIndices);
  const size = mapWidth * mapHeight;
  if (size <= 0) return "";
  const runs: string[] = [];
  let current = explored.has(0) ? 1 : 0;
  let length = 1;
  for (let index = 1; index < size; index += 1) {
    const value = explored.has(index) ? 1 : 0;
    if (value === current) {
      length += 1;
      continue;
    }
    runs.push(`${current}:${length}`);
    current = value;
    length = 1;
  }
  runs.push(`${current}:${length}`);
  return runs.join(",");
}

export function decodeExploredTilesRle(mapWidth: number, mapHeight: number, encoded: string): number[] {
  const size = mapWidth * mapHeight;
  if (size <= 0) return [];
  const explored: number[] = [];
  let offset = 0;
  for (const run of encoded.split(",")) {
    const match = /^([01]):([1-9]\d*)$/.exec(run);
    if (!match) throw new Error("Invalid explored-tile RLE");
    const value = Number(match[1]);
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || offset + length > size) throw new Error("Explored-tile RLE exceeds map bounds");
    if (value === 1) {
      for (let index = offset; index < offset + length; index += 1) explored.push(index);
    }
    offset += length;
  }
  if (offset !== size) throw new Error("Explored-tile RLE does not cover map");
  return explored;
}

function computeVisibleTileIndices(state: MatchState, playerId: PlayerId): number[] {
  const teamId = state.players.find((player) => player.id === playerId)?.teamId;
  if (!teamId) throw new Error(`Unknown visibility recipient: ${playerId}`);
  const visible = new Set<number>();
  const observers = state.entities
    .filter((entity): entity is BuildingEntityState | UnitEntityState => (
      (entity.kind === "unit" || entity.kind === "building")
      && state.players.find((player) => player.id === entity.ownerId)?.teamId === teamId
      && entity.hitPoints > 0
      && (entity.kind === "unit" || entity.complete)
    ))
    .sort((left, right) => compareText(left.id, right.id));

  for (const observer of observers) {
    const radius = observer.kind === "unit" ? UNITS[observer.typeId].sightRadius : BUILDINGS[observer.typeId].sightRadius;
    const origins = observer.kind === "building"
      ? getFootprintCells(observer.position, getBuildingFootprint(observer.typeId, observer.orientation))
      : [observer.position];
    for (const origin of origins) {
      for (const offset of circleOffsets(radius)) {
        const point = { x: origin.x + offset.x, y: origin.y + offset.y };
        if (isPointInBounds(point, state.map.width, state.map.height)) {
          visible.add(tileIndex(point, state.map.width));
        }
      }
    }
  }
  return [...visible].sort(compareNumber);
}

function computeObserverRevision(state: MatchState, playerId: PlayerId): string {
  const teamId = state.players.find((player) => player.id === playerId)?.teamId;
  if (!teamId) throw new Error(`Unknown visibility recipient: ${playerId}`);
  return state.entities
    .filter((entity): entity is BuildingEntityState | UnitEntityState => (
      (entity.kind === "unit" || entity.kind === "building")
      && entity.hitPoints > 0
      && (entity.kind === "unit" || entity.complete)
      && state.players.find((player) => player.id === entity.ownerId)?.teamId === teamId
    ))
    .sort((left, right) => compareText(left.id, right.id))
    .map((entity) => `${entity.id}:${entity.position.x}:${entity.position.y}:${entity.hitPoints > 0 ? 1 : 0}`)
    .join("|");
}

function circleOffsets(radius: number): readonly GridPoint[] {
  const cached = CIRCLE_OFFSETS.get(radius);
  if (cached) return cached;
  const offsets: GridPoint[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) offsets.push({ x, y });
    }
  }
  offsets.sort((left, right) => left.y - right.y || left.x - right.x);
  CIRCLE_OFFSETS.set(radius, offsets);
  return offsets;
}

function entityFootprintVisible(entity: EntityState, visible: ReadonlySet<number>, mapWidth: number): boolean {
  const cells = entity.kind === "building" || entity.kind === "rubble"
    ? getFootprintCells(entity.position, getBuildingFootprint(entity.typeId, entity.orientation))
    : [entity.position];
  return cells.some((cell) => visible.has(tileIndex(cell, mapWidth)));
}

function arePlayersAllied(state: MatchState, leftId: PlayerId, rightId: PlayerId): boolean {
  const left = state.players.find((player) => player.id === leftId);
  const right = state.players.find((player) => player.id === rightId);
  return Boolean(left && right && left.teamId === right.teamId);
}

function arePlayersHostile(state: MatchState, leftId: PlayerId, rightId: PlayerId): boolean {
  return !arePlayersAllied(state, leftId, rightId);
}

function tileIndex(point: GridPoint, mapWidth: number): number {
  return point.y * mapWidth + point.x;
}

function isPointInBounds(point: GridPoint, width: number, height: number): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}

function cloneSighting(sighting: StaleEntitySighting): StaleEntitySighting {
  return { ...sighting, position: { ...sighting.position } };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}
