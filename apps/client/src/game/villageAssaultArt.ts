import Phaser from "phaser";
import {
  BUILDINGS,
  type BuildingEntityState,
  type BuildingType,
  type PublicEntityState,
  type PublicProductionJob,
  type ResourceEntityState,
  type ResourceKind,
  type RubbleEntityState,
  type StaleEntitySighting,
  type StructureOrientation,
} from "@village-siege/shared";
import {
  publicResourceAmount,
  publicResourceRenewAtTick,
  type PublicBuildingEntity,
  type PublicResourceEntity,
  type PublicRubbleEntity,
} from "./assaultPublicPresentation";
import { publicAssetUrl } from "./publicAssetUrl";
import { productionProgressLabel } from "./productionProgress";
import { createNatureImage } from "./battleMap";

export type AssaultSide = "player" | "enemy";
type AssaultRenderableEntity = PublicEntityState | BuildingEntityState | ResourceEntityState | RubbleEntityState;

export interface AssaultEntityView {
  readonly container: Phaser.GameObjects.Container;
  update(entity: AssaultRenderableEntity, selected?: boolean): void;
  setCompact(compact: boolean): void;
  destroy(): void;
}

export interface StaleBuildingView {
  readonly container: Phaser.GameObjects.Container;
  update(sighting: StaleEntitySighting, serverTick: number): void;
  destroy(): void;
}

const INK = 0x101917;
const CHALK = 0xf0ebcf;
const TIMBER = 0x4b3428;
const TIMBER_LIGHT = 0x8a6748;
const STONE = 0x7b7b70;
const STONE_LIGHT = 0xb5af96;
const COPPER = 0xe0b866;
const VERDIGRIS = 0x4f8275;
const EMBER = 0xf08a3c;
const PLAYER = 0x315e4d;
const ENEMY = 0x8f3b3a;

export const FRONTIER_BUILDING_TEXTURE = "frontier-painted-buildings";
export const FRONTIER_BUILDING_PATH = publicAssetUrl("assets/original/frontier/buildings.png");

/** Row-major contract for the original, transparent 4 × 3 raster atlas. */
const PAINTED_BUILDING_ORDER = [
  "townCenter", "house", "barracks", "defenseTower",
  "lumberCamp", "farmstead", "archeryRange", "mageSanctum",
  "gunWorkshop", "beastStable", "siegeWorkshop", "copperLandmark",
] as const satisfies readonly BuildingType[];

const BUILDING_LABELS: Readonly<Record<BuildingType, string>> = {
  townCenter: "村鎮議事堂",
  house: "拓荒家屋",
  lumberCamp: "木作營",
  farmstead: "糧秣所",
  barracks: "邊軍兵營",
  defenseTower: "守望塔",
  archeryRange: "射箭庭",
  mageSanctum: "星火院",
  gunWorkshop: "火器坊",
  beastStable: "獠騎圈",
  siegeWorkshop: "攻城棚",
  resinPalisade: "樹脂石籠牆",
  surveyGate: "測界雙葉門",
  copperLandmark: "拓界銅標",
};

const RESOURCE_LABELS: Readonly<Record<ResourceKind, string>> = {
  food: "糧食堆",
  wood: "林木",
  stone: "石礦",
};

export function buildingDisplayName(type: BuildingType): string {
  return BUILDING_LABELS[type];
}

export function resourceDisplayName(type: ResourceKind): string {
  return RESOURCE_LABELS[type];
}

export function createBuildingView(
  scene: Phaser.Scene,
  entity: PublicBuildingEntity | BuildingEntityState,
  side: AssaultSide | number,
): AssaultEntityView {
  const sideAccent = typeof side === "number" ? side : side === "player" ? PLAYER : ENEMY;
  const shadow = scene.add.ellipse(0, 11, footprintWidth(entity.typeId), footprintHeight(entity.typeId), INK, 0.34);
  const selection = scene.add.graphics();
  const painted = createPaintedBuilding(scene, entity.typeId);
  const art = scene.add.graphics();
  const healthBack = scene.add.rectangle(0, -82, 92, 8, INK, 0.88).setOrigin(0.5);
  const health = scene.add.rectangle(-44, -82, 88, 4, sideAccent).setOrigin(0, 0.5);
  const label = scene.add.text(0, 25, BUILDING_LABELS[entity.typeId], {
    color: "#f0ebcf",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "13px",
    fontStyle: "bold",
    backgroundColor: "#101917cc",
    padding: { x: 5, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2).setVisible(false);
  const progress = scene.add.text(0, -68, "", {
    color: "#e0b866",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    fontStyle: "bold",
    backgroundColor: "#101917cc",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5).setResolution(2).setVisible(false);
  if (painted) {
    const top = painted.y - painted.displayHeight * painted.originY;
    healthBack.setY(top - 8);
    health.setY(top - 8);
    progress.setY(top - 22);
  }
  const container = scene.add.container(0, 0, [shadow, selection, ...(painted ? [painted] : []), art, healthBack, health, label, progress]);
  container.setName(`assault-building:${entity.id}`).setSize(footprintWidth(entity.typeId), painted ? painted.displayHeight + 24 : 120);
  let lastRevision = -1;
  let lastSelected = false;
  let hovered = false;
  const showAttention = (): void => {
    label.setVisible(lastSelected || hovered);
    progress.setVisible(lastSelected && progress.text.length > 0);
  };
  container.on("pointerover", () => { hovered = true; showAttention(); });
  container.on("pointerout", () => { hovered = false; showAttention(); });

  const update = (next: AssaultRenderableEntity, selected = false): void => {
    if (next.kind !== "building") return;
    const building = next as PublicBuildingEntity | BuildingEntityState;
    if (next.stateRevision !== lastRevision) {
      art.clear();
      if (painted) {
        updatePaintedBuilding(painted, art, building.typeId, sideAccent, completionRatio(building), building.hitPoints / building.maxHitPoints);
      } else {
        drawBuilding(art, building.typeId, side, completionRatio(building), building.hitPoints / building.maxHitPoints, building.orientation ?? "ne", building.gateOpen ?? false);
      }
      const ratio = Phaser.Math.Clamp(next.hitPoints / next.maxHitPoints, 0, 1);
      health.setDisplaySize(88 * ratio, 4);
      lastRevision = next.stateRevision;
    }
    const queue: readonly PublicProductionJob[] = "productionQueue" in building
      ? building.productionQueue
      : building.ownerControl?.productionQueue ?? [];
    const complete = building.complete ?? false;
    const progressLabel = complete ? queueText(queue) : `施工 ${Math.floor(completionRatio(building) * 100)}%`;
    if (progress.text !== progressLabel) progress.setText(progressLabel);
    if (complete && queue.length === 0) progress.setText("");
    if (selected !== lastSelected) {
      selection.clear();
      if (selected) {
        selection.lineStyle(3, COPPER, 0.95).strokeEllipse(0, 10, footprintWidth(building.typeId) + 12, footprintHeight(building.typeId) + 10);
      }
      lastSelected = selected;
    }
    healthBack.setVisible(next.hitPoints < next.maxHitPoints || selected);
    health.setVisible(next.hitPoints < next.maxHitPoints || selected);
    showAttention();
  };
  update(entity);
  return {
    container,
    update,
    setCompact: (compact) => { label.setFontSize(compact ? 12 : 13); showAttention(); },
    destroy: () => container.destroy(true),
  };
}

export function createStaleBuildingView(
  scene: Phaser.Scene,
  sighting: StaleEntitySighting,
  serverTick: number,
): StaleBuildingView {
  const shadow = scene.add.ellipse(0, 11, footprintWidth(sighting.typeId), footprintHeight(sighting.typeId), INK, 0.24);
  const painted = createPaintedBuilding(scene, sighting.typeId);
  const art = scene.add.graphics();
  const label = scene.add.text(0, 25, BUILDING_LABELS[sighting.typeId], {
    color: "#c3cbc2",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "12px",
    fontStyle: "bold",
    backgroundColor: "#101917b8",
    padding: { x: 5, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2).setVisible(false);
  const age = scene.add.text(0, -68, "", {
    color: "#aab8ad",
    fontFamily: 'Consolas, "Noto Sans TC", monospace',
    fontSize: "10px",
    backgroundColor: "#101917b8",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5).setResolution(2).setVisible(false);
  if (painted) age.setY(painted.y - painted.displayHeight * painted.originY - 8);
  const container = scene.add.container(0, 0, [shadow, ...(painted ? [painted] : []), art, label, age])
    .setName(`assault-stale-building:${sighting.entityId}`)
    .setAlpha(0.52).setSize(footprintWidth(sighting.typeId), painted ? painted.displayHeight + 24 : 120).setInteractive();
  container.on("pointerover", () => { label.setVisible(true); age.setVisible(true); });
  container.on("pointerout", () => { label.setVisible(false); age.setVisible(false); });
  let lastRevision = -1;

  const update = (next: StaleEntitySighting, currentTick: number): void => {
    if (next.stateRevision !== lastRevision) {
      art.clear();
      const healthRatio = Phaser.Math.Clamp(next.hitPoints / Math.max(1, next.maxHitPoints), 0, 1);
      const completion = completionRatio(next);
      if (painted) {
        updatePaintedBuilding(painted, art, next.typeId, ENEMY, completion, healthRatio);
        painted.setTint(0x8c9992);
      } else {
        drawBuilding(art, next.typeId, "enemy", completion, healthRatio, next.orientation, next.gateOpen ?? false);
      }
      lastRevision = next.stateRevision;
    }
    const elapsedSeconds = Math.max(0, Math.floor((currentTick - next.observedAtTick) / 10));
    age.setText(`最後偵察 ${elapsedSeconds}s`);
  };
  update(sighting, serverTick);
  return { container, update, destroy: () => container.destroy(true) };
}

export function createResourceView(scene: Phaser.Scene, entity: PublicResourceEntity | ResourceEntityState): AssaultEntityView {
  const shadow = scene.add.ellipse(0, 9, 74, 27, INK, 0.28);
  const selection = scene.add.graphics();
  const painted = createNatureImage(scene, entity.typeId === "wood" ? "oakGrove" : entity.typeId === "food" ? "grainPatch" : "stonePile", entity.typeId === "wood" ? 145 : entity.typeId === "food" ? 120 : 110, 24);
  const art = scene.add.graphics();
  const label = scene.add.text(0, 29, RESOURCE_LABELS[entity.typeId], {
    color: "#dce9c6",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "12px",
    fontStyle: "bold",
    backgroundColor: "#101917b8",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2).setVisible(false);
  const amount = scene.add.text(0, -47, "", {
    color: "#f0ebcf",
    fontFamily: "Consolas, monospace",
    fontSize: "11px",
    fontStyle: "bold",
  }).setOrigin(0.5).setResolution(2).setVisible(false);
  const container = scene.add.container(0, 0, [shadow, selection, ...(painted ? [painted] : []), art, label, amount]);
  container.setName(`assault-resource:${entity.id}`).setSize(entity.typeId === "wood" ? 138 : 108, painted ? painted.displayHeight + 18 : 88);
  let lastRevision = -1;
  let lastSelected = false;
  let hovered = false;
  let fallow = false;
  const showAttention = (): void => { label.setVisible(lastSelected || hovered); amount.setVisible(lastSelected); };
  container.on("pointerover", () => { hovered = true; showAttention(); });
  container.on("pointerout", () => { hovered = false; showAttention(); });
  const update = (next: AssaultRenderableEntity, selected = false): void => {
    if (next.kind !== "resource") return;
    const resource = next as PublicResourceEntity | ResourceEntityState;
    if (next.stateRevision !== lastRevision) {
      art.clear();
      const remaining: number = "amount" in resource ? resource.amount : publicResourceAmount(resource);
      if (painted) {
        painted.setVisible(remaining > 0).setAlpha(remaining > 0 ? 0.93 + Math.min(1, remaining / resource.maxHitPoints) * 0.07 : 0);
        if (remaining <= 0 && resource.typeId === "food") art.fillStyle(0x8e7850, 0.35).fillEllipse(0, 8, 62, 24);
      } else drawResource(art, resource.typeId, Phaser.Math.Clamp(remaining / resource.maxHitPoints, 0, 1));
      fallow = remaining <= 0 && ("renewAtTick" in resource ? resource.renewAtTick : publicResourceRenewAtTick(resource)) !== null;
      amount.setText(fallow ? "休耕" : `${Math.max(0, Math.ceil(remaining))}`);
      lastRevision = next.stateRevision;
    }
    if (selected !== lastSelected) {
      selection.clear();
      if (selected) selection.lineStyle(3, COPPER, 0.95).strokeEllipse(0, 8, 86, 36);
      lastSelected = selected;
    }
    showAttention();
  };
  update(entity);
  return {
    container,
    update,
    setCompact: (compact) => {
      label.setFontSize(compact ? 11 : 12);
      showAttention();
    },
    destroy: () => container.destroy(true),
  };
}

export function createRubbleView(scene: Phaser.Scene, entity: PublicRubbleEntity | RubbleEntityState): AssaultEntityView {
  const shadow = scene.add.ellipse(0, 10, footprintWidth(entity.typeId), footprintHeight(entity.typeId), INK, 0.22);
  const art = scene.add.graphics();
  const label = scene.add.text(0, 24, "可通行破口", {
    color: "#d6c7a5",
    fontFamily: '"Segoe UI", "Noto Sans TC", sans-serif',
    fontSize: "11px",
    fontStyle: "bold",
    backgroundColor: "#101917b8",
    padding: { x: 4, y: 2 },
  }).setOrigin(0.5, 0).setResolution(2).setVisible(false);
  const container = scene.add.container(0, 0, [shadow, art, label]);
  container.setName(`assault-rubble:${entity.id}`).setSize(92, 62);
  let lastRevision = -1;
  let selected = false;
  let hovered = false;
  const showAttention = (): void => { label.setVisible(selected || hovered); };
  container.on("pointerover", () => { hovered = true; showAttention(); });
  container.on("pointerout", () => { hovered = false; showAttention(); });
  const update = (next: AssaultRenderableEntity, nextSelected = false): void => {
    selected = nextSelected;
    showAttention();
    if (next.kind !== "rubble" || next.stateRevision === lastRevision) return;
    const rubble = next as PublicRubbleEntity;
    art.clear();
    drawRubble(art, rubble.typeId, rubble.orientation ?? "ne");
    lastRevision = next.stateRevision;
  };
  update(entity);
  return {
    container,
    update,
    setCompact: (compact) => { label.setFontSize(compact ? 10 : 11); showAttention(); },
    destroy: () => container.destroy(true),
  };
}

export function drawBuildGhost(
  graphics: Phaser.GameObjects.Graphics,
  type: BuildingType,
  valid: boolean,
): void {
  graphics.clear();
  drawIsoDiamond(graphics, footprintWidth(type), footprintHeight(type), valid ? 0x89b879 : 0xc85c4a, 0.28, valid ? 0xb7e4a7 : 0xff9d86);
  graphics.lineStyle(3, valid ? 0xb7e4a7 : 0xff9d86, 0.95).strokeEllipse(0, 5, footprintWidth(type) + 12, footprintHeight(type) + 8);
}

function completionRatio(entity: PublicBuildingEntity | BuildingEntityState | StaleEntitySighting): number {
  if (entity.complete) return 1;
  return Phaser.Math.Clamp(entity.hitPoints / entity.maxHitPoints, 0.08, 0.99);
}

function queueText(queue: readonly PublicProductionJob[]): string {
  if (queue.length === 0) return "";
  const job = queue[0]!;
  return `列${queue.length} · ${productionProgressLabel(job)}`;
}

function createPaintedBuilding(scene: Phaser.Scene, type: BuildingType): Phaser.GameObjects.Image | undefined {
  const index = PAINTED_BUILDING_ORDER.findIndex((candidate) => candidate === type);
  if (index < 0 || !scene.textures.exists(FRONTIER_BUILDING_TEXTURE)) return undefined;
  const texture = scene.textures.get(FRONTIER_BUILDING_TEXTURE);
  if (!texture.has(type)) {
    const base = texture.get("__BASE");
    // Read the delivered PNG size rather than coupling loading to an image model's output resolution.
    const cellWidth = Math.floor(base.cutWidth / 4);
    const cellHeight = Math.floor(base.cutHeight / 3);
    if (cellWidth <= 0 || cellHeight <= 0) return undefined;
    texture.add(type, 0, index % 4 * cellWidth, Math.floor(index / 4) * cellHeight, cellWidth, cellHeight);
  }
  const image = scene.add.image(0, footprintHeight(type) / 2 - 4, FRONTIER_BUILDING_TEXTURE, type).setOrigin(0.5, 0.85);
  const width = footprintWidth(type) * 1.16;
  image.setDisplaySize(width, width * image.frame.cutHeight / image.frame.cutWidth);
  return image;
}

function updatePaintedBuilding(
  image: Phaser.GameObjects.Image,
  overlay: Phaser.GameObjects.Graphics,
  type: BuildingType,
  accent: number,
  completion: number,
  healthRatio: number,
): void {
  const width = footprintWidth(type);
  image.setVisible(completion >= 0.34).setAlpha(completion < 1 ? 0.76 : 1);
  image.clearTint();
  if (completion < 1) {
    const cropY = Math.floor(image.frame.cutHeight * (1 - completion));
    image.setCrop(0, cropY, image.frame.cutWidth, image.frame.cutHeight - cropY);
    if (completion < 0.34) drawIsoDiamond(overlay, width, footprintHeight(type), STONE, 1, INK);
    drawScaffolding(overlay, width, -6, Math.max(14, 72 * completion), accent);
  } else {
    image.setCrop();
    if (healthRatio < 0.58) {
      image.setTint(0xc8b6a2);
      drawDamage(overlay, healthRatio);
    }
  }
  drawOwnerHeraldry(overlay, width, accent);
}

/** Team color stays explicit without tinting the hand-painted material palette. */
function drawOwnerHeraldry(graphics: Phaser.GameObjects.Graphics, width: number, accent: number): void {
  const x = -width * 0.35;
  graphics.lineStyle(2, INK, 0.85).lineBetween(x, 10, x, -16);
  graphics.fillStyle(accent, 1).fillTriangle(x - 7, -15, x + 7, -15, x, -3).fillRect(x - 7, -21, 14, 7);
  graphics.lineStyle(1, COPPER, 0.95).strokeTriangle(x - 7, -15, x + 7, -15, x, -3).lineBetween(x - 7, -21, x + 7, -21);
  graphics.fillStyle(CHALK, 0.92).fillCircle(x, -14, 2);
}

function footprintWidth(type: BuildingType): number {
  const footprint = BUILDINGS[type].footprint;
  return (Math.max(...footprint.map((cell) => cell.x)) + Math.max(...footprint.map((cell) => cell.y)) + 2) * 48;
}

function footprintHeight(type: BuildingType): number {
  return footprintWidth(type) / 2;
}

function drawBuilding(
  g: Phaser.GameObjects.Graphics,
  type: BuildingType,
  side: AssaultSide | number,
  completion: number,
  healthRatio: number,
  orientation: StructureOrientation,
  gateOpen = false,
): void {
  const accent = typeof side === "number" ? side : side === "player" ? PLAYER : ENEMY;
  const width = footprintWidth(type);
  const height = footprintHeight(type);
  drawIsoDiamond(g, width, height, STONE, 1, INK);
  if (completion < 0.34) {
    drawScaffolding(g, width, -2, 35 * completion + 8, accent);
    return;
  }
  if (type === "resinPalisade") {
    drawResinPalisade(g, accent, completion, orientation);
  } else if (type === "surveyGate") {
    drawSurveyGate(g, accent, completion, orientation, gateOpen);
  } else if (type === "copperLandmark") {
    drawCopperLandmark(g, accent, completion, orientation);
  } else if (type === "defenseTower") {
    drawTower(g, accent, completion);
  } else if (type === "townCenter") {
    drawTownCenter(g, accent, completion);
  } else if (type === "archeryRange") {
    drawArcheryRange(g, accent, completion);
  } else if (type === "mageSanctum") {
    drawMageSanctum(g, accent, completion);
  } else if (type === "gunWorkshop") {
    drawGunWorkshop(g, accent, completion);
  } else if (type === "beastStable") {
    drawBeastStable(g, accent, completion);
  } else if (type === "siegeWorkshop") {
    drawSiegeWorkshop(g, accent, completion);
  } else {
    drawHall(g, type, accent, completion);
  }
  if (completion < 1) drawScaffolding(g, width, -6, 55 * completion, accent);
  if (completion >= 1 && healthRatio < 0.58) drawDamage(g, healthRatio);
}

function drawResinPalisade(g: Phaser.GameObjects.Graphics, accent: number, completion: number, orientation: StructureOrientation): void {
  const rise = 46 * Math.min(1, (completion - 0.16) / 0.72);
  const direction = orientation === "ne" ? 1 : -1;
  g.lineStyle(7, 0x5b3d2c, 1)
    .lineBetween(-31, 9, 31, -8 * direction)
    .lineBetween(-31, 16, 31, 0 - 8 * direction);
  for (let index = 0; index < 6; index += 1) {
    const x = -29 + index * 12;
    const y = 10 - index * 3 * direction;
    const top = y - rise - (index % 2) * 5;
    g.fillStyle(index % 2 ? 0x745039 : TIMBER_LIGHT, 1).fillTriangle(x - 5, top + 9, x, top, x + 5, top + 9).fillRect(x - 5, top + 8, 10, rise);
    g.lineStyle(2, INK, 0.68).lineBetween(x - 5, top + 10, x - 5, y);
    g.fillStyle(0xd4b56b, 0.9).fillCircle(x + 2, top + 18, 2);
  }
  // Woven shale gabion and resin lashings are the fortification's original material signature.
  for (let index = 0; index < 5; index += 1) {
    const x = -28 + index * 14;
    const y = 12 - index * 3 * direction;
    g.fillStyle(index % 2 ? 0x77776d : STONE_LIGHT, 1).fillCircle(x, y, 7);
    g.lineStyle(1, 0x4e514a, 0.8).strokeCircle(x, y, 7);
  }
  g.lineStyle(3, accent, 0.95).lineBetween(-27, -11, 28, -27 * direction);
}

function drawSurveyGate(
  g: Phaser.GameObjects.Graphics,
  accent: number,
  completion: number,
  orientation: StructureOrientation,
  open: boolean,
): void {
  const rise = 54 * Math.min(1, (completion - 0.14) / 0.74);
  const direction = orientation === "ne" ? 1 : -1;
  for (const side of [-1, 1]) {
    const x = side * 43;
    const y = side * -7 * direction + 7;
    drawIsoBlock(g, x, y, 24, 19, rise, STONE_LIGHT, 0x73746b, 0x5c5e57);
    g.fillStyle(COPPER, 1).fillRect(x - 10, y - rise - 6, 20, 6);
    flag(g, x + side * 3, y - rise - 26, side < 0 ? accent : VERDIGRIS);
  }
  const leftHinge = { x: -34, y: 2 + 7 * direction };
  const rightHinge = { x: 34, y: 2 - 7 * direction };
  if (open) {
    drawGateLeaf(g, leftHinge.x, leftHinge.y, -1, direction, 27, accent);
    drawGateLeaf(g, rightHinge.x, rightHinge.y, 1, direction, 27, accent);
    g.lineStyle(4, CHALK, 0.5).lineBetween(-19, 6, 19, -1 * direction);
  } else {
    drawGateLeaf(g, leftHinge.x, leftHinge.y, 1, direction, 58, accent);
    drawGateLeaf(g, rightHinge.x, rightHinge.y, -1, direction, 58, accent);
    g.lineStyle(6, 0x513625, 1).lineBetween(-32, -22, 32, -5).lineBetween(-31, -5, 31, -25);
    g.fillStyle(COPPER, 1).fillCircle(0, -15, 5);
  }
}

function drawGateLeaf(g: Phaser.GameObjects.Graphics, x: number, y: number, side: number, direction: number, width: number, accent: number): void {
  const outerX = x + side * width;
  const outerY = y - direction * width * 0.24;
  g.lineStyle(9, TIMBER_LIGHT, 1)
    .lineBetween(x, y - 7, outerX, outerY - 7)
    .lineBetween(x, y - 27, outerX, outerY - 27)
    .lineBetween(x, y - 47, outerX, outerY - 47);
  g.lineStyle(5, TIMBER, 1).lineBetween(x, y - 51, x, y).lineBetween(outerX, outerY - 49, outerX, outerY - 2);
  g.lineStyle(3, accent, 0.9).lineBetween(x + side * 5, y - 43, outerX - side * 4, outerY - 10);
}

function drawCopperLandmark(g: Phaser.GameObjects.Graphics, accent: number, completion: number, orientation: StructureOrientation): void {
  const rise = 72 * Math.min(1, (completion - 0.13) / 0.77);
  const direction = orientation === "ne" ? 1 : -1;
  drawIsoBlock(g, 0, 9, 72, 34, 16, 0x8d8978, 0x6b685d, 0x56544d);
  g.lineStyle(8, TIMBER, 1)
    .lineBetween(-29, 5, -8, 5 - rise)
    .lineBetween(29, 5, 8, 5 - rise)
    .lineBetween(-3, 12, 0, 1 - rise - 15);
  g.lineStyle(3, CHALK, 0.86)
    .lineBetween(-27, -18, 18, -rise + 4)
    .lineBetween(26, -16, -16, -rise + 1);
  const discY = 4 - rise;
  g.fillStyle(0x936f38, 1).fillCircle(0, discY, 25);
  g.lineStyle(5, COPPER, 1).strokeCircle(0, discY, 25).strokeCircle(0, discY, 15);
  g.lineStyle(3, INK, 0.85)
    .lineBetween(-20, discY, 20, discY)
    .lineBetween(0, discY - 20, 0, discY + 20)
    .lineBetween(-14, discY - 14, 14, discY + 14 * direction);
  g.fillStyle(CHALK, 1).fillCircle(0, discY, 5);
  flag(g, 20, discY - 37, accent);
  drawSurveyStakes(g, VERDIGRIS, [[-47, 13], [48, 12], [0, 29]]);
}

function drawRubble(g: Phaser.GameObjects.Graphics, sourceType: BuildingType, orientation: StructureOrientation): void {
  const direction = orientation === "ne" ? 1 : -1;
  const scale = sourceType === "copperLandmark" ? 1.25 : sourceType === "surveyGate" ? 1.1 : 0.9;
  for (let index = 0; index < 7; index += 1) {
    const x = (-31 + index * 11) * scale;
    const y = ((index % 3) * 5 - 1 - index * direction) * 0.7;
    const size = (5 + index % 3 * 2) * scale;
    g.fillStyle(index % 2 ? STONE_LIGHT : STONE, 0.96)
      .fillTriangle(x - size, y + size * 0.5, x + size, y + size * 0.4, x + size * 0.2, y - size);
  }
  g.lineStyle(7, TIMBER, 1)
    .lineBetween(-34 * scale, -3, -7 * scale, 8)
    .lineBetween(10 * scale, 7, 35 * scale, -8 * direction);
  g.lineStyle(3, 0xc6a55d, 0.86).lineBetween(-19, 9, 18, -7 * direction);
  g.fillStyle(COPPER, 0.95).fillTriangle(20, 7, 31, 1, 27, 13);
}

function drawTownCenter(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const wallHeight = 42 * Math.min(1, (completion - 0.2) / 0.55);
  drawIsoBlock(g, -38, 8, 76, 30, wallHeight, 0xc4b88e, 0x93866b, 0x75684f);
  drawIsoBlock(g, 25, 1, 38, 25, wallHeight + 11, STONE_LIGHT, 0x858478, 0x66635a);
  roof(g, -38, 8 - wallHeight, 84, 37, accent, 0x572d2c);
  roof(g, 25, 1 - wallHeight - 11, 47, 30, accent, 0x572d2c);
  timberFrame(g, -38, 9, 70, wallHeight);
  g.fillStyle(INK, 0.9).fillRect(-7, -23, 14, 31);
  g.fillStyle(COPPER, 1).fillCircle(2, -7, 2.5);
  flag(g, 47, -69, accent);
}

function drawArcheryRange(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const rise = 34 * Math.min(1, (completion - 0.22) / 0.58);
  drawIsoBlock(g, -18, 7, 62, 27, rise, 0xc6b98e, 0x88735a, 0x6e5b47);
  roof(g, -18, 7 - rise, 70, 31, accent, 0x4d2e2c);
  timberFrame(g, -18, 8, 54, rise);

  // A pale target and its exposed arrow rack keep the yard readable even at compact zoom.
  g.lineStyle(5, TIMBER, 1).lineBetween(31, 8, 31, -20).lineBetween(21, 8, 31, -1).lineBetween(41, 8, 31, -1);
  g.fillStyle(CHALK, 1).fillCircle(31, -24, 12);
  g.lineStyle(3, accent, 1).strokeCircle(31, -24, 8);
  g.fillStyle(INK, 1).fillCircle(31, -24, 3);
  g.lineStyle(3, TIMBER_LIGHT, 1).lineBetween(-48, 11, -39, -9).lineBetween(-30, 11, -39, -9).lineBetween(-48, 3, -30, 3);
  for (let index = 0; index < 4; index += 1) {
    const x = -46 + index * 5;
    g.lineStyle(2, COPPER, 1).lineBetween(x, 1, x + 8, -22);
    g.fillStyle(accent, 1).fillTriangle(x + 8, -22, x + 3, -17, x + 10, -16);
  }
  drawSurveyStakes(g, accent, [[-49, 9], [50, 8], [4, 21]]);
}

function drawMageSanctum(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const rise = 39 * Math.min(1, (completion - 0.22) / 0.58);
  drawIsoBlock(g, 0, 7, 64, 31, rise, STONE_LIGHT, 0x7b7d73, 0x62665f);
  drawIsoDiamondAt(g, 0, 7 - rise, 72, 35, VERDIGRIS, 1, INK);
  g.fillStyle(INK, 0.9).fillRect(-6, 7 - rise, 12, rise);
  g.fillStyle(COPPER, 0.9).fillCircle(0, -12, 3);

  // Oxidised copper astronomy rings form the sanctum's unmistakable crown.
  const crownY = -rise - 18;
  g.lineStyle(4, COPPER, 1).strokeEllipse(0, crownY, 56, 20);
  g.lineStyle(4, VERDIGRIS, 1).strokeEllipse(0, crownY, 22, 49);
  g.lineStyle(2, CHALK, 0.9).lineBetween(-24, crownY, 24, crownY).lineBetween(0, crownY - 21, 0, crownY + 21);
  g.fillStyle(EMBER, 0.32).fillCircle(0, crownY, 11);
  g.fillStyle(CHALK, 1).fillCircle(0, crownY, 5);

  // The open star-fire kiln anchors the rings to a practical frontier workshop.
  g.fillStyle(TIMBER, 1).fillRect(25, -5, 20, 14);
  g.lineStyle(3, COPPER, 1).strokeRect(25, -5, 20, 14);
  g.fillStyle(EMBER, 0.95).fillTriangle(28, 5, 35, -12, 41, 5);
  g.fillStyle(CHALK, 0.8).fillCircle(35, -1, 3);
  drawSurveyStakes(g, accent, [[-45, 8], [46, 8], [-1, 22]]);
}

function drawGunWorkshop(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const rise = 36 * Math.min(1, (completion - 0.22) / 0.58);
  drawIsoBlock(g, -6, 7, 78, 30, rise, 0xb8aa83, 0x81715b, 0x685947);
  roof(g, -6, 7 - rise, 88, 35, accent, 0x3f2d2a);
  timberFrame(g, -6, 8, 69, rise);
  g.fillStyle(INK, 0.93).fillRect(-12, -20, 16, 28);

  // Twin soot stacks and clustered powder casks establish a low, industrial silhouette.
  for (const [x, extra] of [[19, 0], [32, 8]] as const) {
    const top = -rise - 22 - extra;
    g.fillStyle(0x444942, 1).fillRect(x - 5, top, 10, 31 + extra);
    g.fillStyle(STONE, 1).fillRect(x - 8, top - 4, 16, 6);
    if (completion > 0.75) {
      g.fillStyle(0x343b38, 0.33).fillCircle(x + 2, top - 12, 8).fillCircle(x - 4, top - 23, 6);
    }
  }
  drawPowderBarrel(g, -45, 5, accent);
  drawPowderBarrel(g, -34, -1, accent);
  g.lineStyle(4, COPPER, 1).lineBetween(-48, -16, -27, -16).lineBetween(-44, -22, -31, -10);
  drawSurveyStakes(g, accent, [[-51, 10], [50, 9], [8, 22]]);
}

function drawBeastStable(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const rise = 35 * Math.min(1, (completion - 0.22) / 0.58);
  drawIsoBlock(g, -23, 6, 58, 29, rise, 0xa98c66, 0x735f4b, 0x5e4e3e);
  roof(g, -23, 6 - rise, 66, 34, accent, 0x4a3028);
  timberFrame(g, -23, 8, 50, rise);
  g.fillStyle(INK, 0.9).fillRect(-30, -19, 17, 27);

  // The open paddock deliberately breaks the roof mass into a stable plus animal yard.
  drawFenceRun(g, 7, -3, 50, -12);
  drawFenceRun(g, 7, 8, 50, 17);
  g.lineStyle(4, TIMBER_LIGHT, 1).lineBetween(50, -12, 50, 17);
  g.fillStyle(0x6f4a2e, 1).fillEllipse(29, 4, 29, 15);
  g.fillStyle(0x3c2b22, 1).fillCircle(42, 2, 7);
  g.fillStyle(CHALK, 1).fillTriangle(44, 2, 53, -2, 46, 7).fillTriangle(40, 5, 49, 11, 42, 0);
  g.fillStyle(TIMBER, 1).fillRect(9, 6, 25, 7);
  g.lineStyle(2, COPPER, 0.85).lineBetween(10, 7, 33, 11);
  drawSurveyStakes(g, accent, [[-51, 10], [53, 17], [6, 20]]);
}

function drawSiegeWorkshop(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const rise = 48 * Math.min(1, (completion - 0.2) / 0.62);
  drawIsoBlock(g, 0, 10, 86, 31, 10, 0x9c8c6d, 0x706352, 0x5d5143);

  // A broad exposed A-frame, axle and paired wheels read as a machine yard rather than a hall.
  g.lineStyle(7, TIMBER, 1)
    .lineBetween(-43, 7, -27, 7 - rise)
    .lineBetween(-9, 7, -27, 7 - rise)
    .lineBetween(9, 7, 27, 7 - rise)
    .lineBetween(44, 7, 27, 7 - rise)
    .lineBetween(-30, 8 - rise, 30, 8 - rise);
  g.lineStyle(3, COPPER, 1).lineBetween(-27, 8 - rise, 27, 8 - rise);
  if (completion > 0.62) roof(g, 0, 8 - rise, 90, 29, accent, 0x4b3328);

  g.lineStyle(7, TIMBER_LIGHT, 1).lineBetween(-32, -5, 34, 6);
  drawTimberWheel(g, -31, -1, 15, accent);
  drawTimberWheel(g, 33, 9, 15, accent);
  g.fillStyle(COPPER, 1).fillCircle(-31, -1, 4).fillCircle(33, 9, 4);
  g.lineStyle(5, TIMBER_LIGHT, 1).lineBetween(-3, 2 - rise, -3, -14).lineBetween(-3, -14, 14, -8);
  g.fillStyle(INK, 0.85).fillCircle(14, -8, 4);
  drawSurveyStakes(g, accent, [[-55, 10], [56, 11], [0, 25]]);
}

function drawHall(g: Phaser.GameObjects.Graphics, type: BuildingType, accent: number, completion: number): void {
  const wallHeight = (type === "barracks" ? 39 : 33) * Math.min(1, (completion - 0.2) / 0.55);
  const width = type === "barracks" || type === "farmstead" ? 78 : 60;
  drawIsoBlock(g, 0, 7, width, type === "barracks" ? 29 : 25, wallHeight, type === "lumberCamp" ? 0xa88b61 : 0xc6b98e, 0x8b775d, 0x6d5e49);
  roof(g, 0, 7 - wallHeight, width + 12, type === "barracks" ? 34 : 30, accent, 0x4d2e2c);
  timberFrame(g, 0, 8, width - 8, wallHeight);
  if (type === "house") {
    g.fillStyle(0x4a241e, 1).fillRect(-6, -18, 12, 26);
    g.fillStyle(COPPER, 0.9).fillRect(15, -20, 10, 10);
  } else if (type === "lumberCamp") {
    for (let i = 0; i < 4; i += 1) {
      g.lineStyle(7, TIMBER_LIGHT, 1).lineBetween(-43 + i * 12, 12 + i * 2, -24 + i * 12, -1 + i * 2);
      g.lineStyle(2, INK, 0.7).strokeCircle(-43 + i * 12, 12 + i * 2, 4);
    }
  } else if (type === "farmstead") {
    g.fillStyle(0xb89543, 1).fillEllipse(-32, 11, 24, 10).fillEllipse(30, 8, 22, 9);
    g.lineStyle(2, 0x6c4b2d, 1).lineBetween(-40, 9, -27, -2).lineBetween(36, 8, 23, -3);
  } else if (type === "barracks") {
    g.fillStyle(INK, 0.92).fillRect(-8, -24, 16, 32);
    g.lineStyle(4, COPPER, 1).lineBetween(27, -34, 38, -3).lineBetween(38, -34, 27, -3);
    flag(g, 39, -56, accent);
  }
}

function drawTower(g: Phaser.GameObjects.Graphics, accent: number, completion: number): void {
  const height = 70 * Math.min(1, (completion - 0.15) / 0.7);
  drawIsoBlock(g, 0, 7, 38, 25, height, STONE_LIGHT, 0x797b73, 0x62645d);
  drawIsoDiamondAt(g, 0, 7 - height, 54, 28, accent, 1, INK);
  for (const x of [-21, -7, 7, 21]) g.fillStyle(STONE_LIGHT, 1).fillRect(x - 4, -height - 8, 8, 15);
  g.fillStyle(INK, 0.9).fillRect(-4, -height + 10, 8, 18);
  flag(g, 9, -height - 37, accent);
}

function drawResource(g: Phaser.GameObjects.Graphics, type: ResourceKind, ratio: number): void {
  const count = ratio <= 0 ? 0 : Math.max(1, Math.ceil(4 * ratio));
  if (type === "wood") {
    for (let index = 0; index < count; index += 1) {
      const x = [-24, -7, 18, 31][index]!;
      const y = [3, -8, 5, -3][index]!;
      g.fillStyle(0x253d2b, 0.22).fillEllipse(x + 4, y + 4, 39, 12);
      g.lineStyle(6, TIMBER, 1).lineBetween(x, y + 3, x, y - 37);
      g.lineStyle(2, TIMBER_LIGHT, 0.9).lineBetween(x - 1, y + 1, x - 1, y - 30);
      g.fillStyle(index % 2 ? 0x3e5d39 : 0x345334, 1)
        .fillEllipse(x, y - 44, 45, 43)
        .fillEllipse(x - 14, y - 34, 30, 28)
        .fillEllipse(x + 16, y - 36, 28, 29);
      g.fillStyle(0x708a4d, 0.82).fillEllipse(x - 7, y - 51, 29, 21).fillEllipse(x + 14, y - 38, 19, 16);
      g.fillStyle(0xa0ab65, 0.55).fillEllipse(x - 11, y - 54, 17, 8).fillEllipse(x + 12, y - 43, 11, 6);
    }
    if (count === 0) {
      g.fillStyle(TIMBER, 1).fillEllipse(-8, 6, 17, 8).fillRect(-16, 0, 16, 6);
      g.fillStyle(TIMBER_LIGHT, 1).fillEllipse(-8, 0, 17, 7);
      g.lineStyle(1, 0xc0a075, 0.8).strokeEllipse(-8, 0, 10, 4);
    }
  } else if (type === "stone") {
    const stoneCount = count === 0 ? 0 : count + 1;
    for (let index = 0; index < stoneCount; index += 1) {
      const x = [-29, -12, 9, 28, 2][index]!;
      const y = [4, -7, 5, -1, -16][index]!;
      g.fillStyle(index % 2 === 0 ? STONE_LIGHT : STONE, 1)
        .fillTriangle(x - 15, y + 10, x + 13, y + 7, x + 5, y - 20);
      g.fillStyle(0x6e7464, 0.8).fillTriangle(x + 5, y - 20, x + 13, y + 7, x - 2, y + 1);
      g.lineStyle(1, 0xd0c5a6, 0.8).lineBetween(x - 12, y + 5, x + 4, y - 17);
      g.fillStyle(0x718246, 0.5).fillEllipse(x - 4, y + 8, 15, 5);
    }
  } else {
    g.fillStyle(0x7f5b32, 1).fillEllipse(0, 8, 68, 24);
    if (count === 0) {
      g.lineStyle(2, 0x9b7646, 0.8)
        .lineBetween(-25, 4, -10, 8)
        .lineBetween(-5, 1, 12, 6)
        .lineBetween(15, 9, 29, 4);
      return;
    }
    for (let index = 0; index < count * 3; index += 1) {
      const x = -29 + (index % 6) * 12;
      const y = 7 - Math.floor(index / 6) * 12;
      g.lineStyle(3, 0xc29c43, 1).lineBetween(x, y + 4, x + (index % 2 ? 4 : -4), y - 16);
      g.fillStyle(0xe0c56b, 1).fillEllipse(x + (index % 2 ? 3 : -3), y - 12, 7, 12);
    }
    g.fillStyle(0x6b4228, 1).fillRect(-33, -3, 15, 19).fillRect(19, 0, 18, 16);
    g.lineStyle(2, COPPER, 0.8).strokeRect(-33, -3, 15, 19).strokeRect(19, 0, 18, 16);
  }
}

function drawIsoDiamond(g: Phaser.GameObjects.Graphics, width: number, height: number, fill: number, alpha: number, stroke: number): void {
  drawIsoDiamondAt(g, 0, 8, width, height, fill, alpha, stroke);
}

function drawIsoDiamondAt(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number, fill: number, alpha: number, stroke: number): void {
  g.fillStyle(fill, alpha).beginPath().moveTo(x, y - height / 2).lineTo(x + width / 2, y).lineTo(x, y + height / 2).lineTo(x - width / 2, y).closePath().fillPath();
  g.lineStyle(2, stroke, 0.85).beginPath().moveTo(x, y - height / 2).lineTo(x + width / 2, y).lineTo(x, y + height / 2).lineTo(x - width / 2, y).closePath().strokePath();
}

function drawIsoBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, depth: number, height: number, front: number, right: number, left: number): void {
  const halfW = width / 2;
  const halfD = depth / 2;
  polygon(g, left, [[x - halfW, y], [x, y + halfD], [x, y + halfD - height], [x - halfW, y - height]]);
  polygon(g, right, [[x, y + halfD], [x + halfW, y], [x + halfW, y - height], [x, y + halfD - height]]);
  polygon(g, front, [[x, y - halfD - height], [x + halfW, y - height], [x, y + halfD - height], [x - halfW, y - height]]);
  g.lineStyle(2, INK, 0.72).lineBetween(x - halfW, y, x, y + halfD).lineBetween(x, y + halfD, x + halfW, y);
}

function roof(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, depth: number, color: number, shade: number): void {
  const ridgeY = y - depth * 0.72;
  polygon(g, color, [[x, ridgeY], [x + width / 2, y], [x, y + depth / 2], [x - width / 2, y]]);
  polygon(g, shade, [[x, ridgeY], [x + width / 2, y], [x, y + depth / 2]]);
  g.lineStyle(2, INK, 0.85).lineBetween(x, ridgeY, x - width / 2, y).lineBetween(x, ridgeY, x + width / 2, y);
}

function timberFrame(g: Phaser.GameObjects.Graphics, x: number, y: number, width: number, height: number): void {
  if (height < 8) return;
  g.lineStyle(4, TIMBER, 1)
    .lineBetween(x - width / 2 + 8, y - height + 4, x - width / 2 + 8, y - 1)
    .lineBetween(x + width / 2 - 8, y - height + 4, x + width / 2 - 8, y - 1)
    .lineBetween(x - width / 2 + 8, y - height + 7, x + width / 2 - 8, y - 1)
    .lineBetween(x + width / 2 - 8, y - height + 7, x - width / 2 + 8, y - 1);
}

function drawScaffolding(g: Phaser.GameObjects.Graphics, width: number, y: number, height: number, accent: number): void {
  g.lineStyle(4, TIMBER_LIGHT, 0.95);
  for (const x of [-width / 2 + 6, width / 2 - 6]) g.lineBetween(x, y + 13, x, y - height);
  g.lineBetween(-width / 2 + 3, y - height * 0.55, width / 2 - 3, y - height * 0.55);
  g.lineBetween(-width / 2 + 3, y, width / 2 - 3, y - height);
  g.fillStyle(accent, 0.92).fillRect(-17, y - height - 7, 34, 9);
}

function drawSurveyStakes(
  g: Phaser.GameObjects.Graphics,
  accent: number,
  points: readonly (readonly [number, number])[],
): void {
  for (const [x, y] of points) {
    g.lineStyle(3, TIMBER_LIGHT, 1).lineBetween(x, y + 5, x, y - 11);
    g.fillStyle(accent, 1).fillRect(x - 4, y - 12, 8, 4);
    g.lineStyle(1, CHALK, 0.8).lineBetween(x - 3, y - 10, x + 3, y - 10);
  }
}

function drawPowderBarrel(g: Phaser.GameObjects.Graphics, x: number, y: number, accent: number): void {
  g.fillStyle(TIMBER_LIGHT, 1).fillRect(x - 7, y - 14, 14, 17);
  g.fillStyle(TIMBER, 1).fillEllipse(x, y - 14, 14, 6).fillEllipse(x, y + 3, 14, 6);
  g.lineStyle(2, COPPER, 1).lineBetween(x - 7, y - 10, x + 7, y - 10).lineBetween(x - 7, y - 1, x + 7, y - 1);
  g.fillStyle(accent, 0.9).fillCircle(x, y - 6, 2);
}

function drawFenceRun(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
  const middleX = (x1 + x2) / 2;
  const middleY = (y1 + y2) / 2;
  g.lineStyle(4, TIMBER_LIGHT, 1)
    .lineBetween(x1, y1 + 5, x1, y1 - 16)
    .lineBetween(middleX, middleY + 5, middleX, middleY - 16)
    .lineBetween(x2, y2 + 5, x2, y2 - 16)
    .lineBetween(x1, y1 - 10, x2, y2 - 10)
    .lineBetween(x1, y1, x2, y2);
}

function drawTimberWheel(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, accent: number): void {
  g.lineStyle(5, TIMBER, 1).strokeCircle(x, y, radius);
  g.lineStyle(2, TIMBER_LIGHT, 1)
    .lineBetween(x - radius + 3, y, x + radius - 3, y)
    .lineBetween(x, y - radius + 3, x, y + radius - 3)
    .lineBetween(x - radius * 0.65, y - radius * 0.65, x + radius * 0.65, y + radius * 0.65)
    .lineBetween(x + radius * 0.65, y - radius * 0.65, x - radius * 0.65, y + radius * 0.65);
  g.fillStyle(accent, 1).fillCircle(x, y, 3);
}

function drawDamage(g: Phaser.GameObjects.Graphics, healthRatio: number): void {
  g.lineStyle(3, 0x37251d, 0.95).lineBetween(-15, -46, -4, -35).lineBetween(-4, -35, -12, -23);
  g.fillStyle(0x2b302d, 0.35 + (0.58 - healthRatio)).fillCircle(18, -58, 13).fillCircle(27, -73, 8);
}

function flag(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  g.lineStyle(3, INK, 1).lineBetween(x, y + 28, x, y);
  g.fillStyle(color, 1).fillTriangle(x, y, x + 25, y + 8, x, y + 16);
  g.lineStyle(1, COPPER, 0.9).lineBetween(x + 3, y + 4, x + 18, y + 8);
}

function polygon(g: Phaser.GameObjects.Graphics, color: number, points: readonly [number, number][]): void {
  const first = points[0];
  if (!first) return;
  g.fillStyle(color, 1).beginPath().moveTo(first[0], first[1]);
  for (let index = 1; index < points.length; index += 1) g.lineTo(points[index]![0], points[index]![1]);
  g.closePath().fillPath();
}
