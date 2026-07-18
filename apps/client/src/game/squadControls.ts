import type { GridPoint, ScreenPoint } from "./isometric";

export type ControlGroupSlot = 1 | 2 | 3;
export type FormationKind = "line" | "wedge";

/** Minimal scene-independent shape needed by the selection controller. */
export interface SquadMember {
  readonly id: string;
  readonly teamId: string;
  readonly position: GridPoint;
  readonly alive?: boolean;
  readonly selectable?: boolean;
}

/**
 * Camera-aware scenes implement this boundary instead of leaking Phaser camera
 * or container state into the deterministic squad-control module.
 */
export interface ScreenGridAdapter<TMember extends SquadMember = SquadMember> {
  screenToGrid(point: ScreenPoint): GridPoint;
  gridToScreen(point: GridPoint): ScreenPoint;
  memberScreenPoint(member: TMember): ScreenPoint;
}

export interface PointerRectangle {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface SquadShortcut {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface SquadSelectionSnapshot {
  readonly selectedIds: readonly string[];
  readonly controlGroups: Readonly<Record<ControlGroupSlot, readonly string[]>>;
}

export interface FormationMember {
  readonly id: string;
  readonly position: GridPoint;
}

/** x is lateral offset; y is distance behind the formation's forward point. */
export interface FormationSlot extends GridPoint {
  readonly x: number;
  readonly y: number;
}

export interface FormationOptions {
  readonly kind?: FormationKind;
  readonly spacing?: number;
  /** Grid-space vector pointing from the squad toward its destination. */
  readonly forward?: GridPoint;
}

export interface FormationAssignment<TMember extends FormationMember = FormationMember> {
  readonly member: TMember;
  readonly memberId: string;
  readonly slotIndex: number;
  readonly destination: GridPoint;
}

export function createPointerRectangle(start: ScreenPoint, end: ScreenPoint): PointerRectangle {
  assertFinitePoint(start, "pointer start");
  assertFinitePoint(end, "pointer end");
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function pointerRectangleContains(
  rectangle: PointerRectangle,
  point: ScreenPoint,
  padding = 0,
): boolean {
  assertFinitePoint(point, "pointer test point");
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RangeError(`Pointer rectangle padding must be a non-negative finite number; received ${padding}`);
  }
  return point.x >= rectangle.left - padding
    && point.x <= rectangle.right + padding
    && point.y >= rectangle.top - padding
    && point.y <= rectangle.bottom + padding;
}

/**
 * Deterministic RTS selection state. The controller has no Phaser or DOM
 * dependency; scenes decide when to prevent browser defaults and how to render.
 */
export class SquadSelectionController<TMember extends SquadMember = SquadMember> {
  private selected: string[] = [];
  private readonly groups: Record<ControlGroupSlot, string[]> = { 1: [], 2: [], 3: [] };

  constructor(readonly localTeamId: string) {
    if (!localTeamId) throw new Error("SquadSelectionController requires a non-empty localTeamId");
  }

  get selectedIds(): readonly string[] {
    return [...this.selected];
  }

  snapshot(): SquadSelectionSnapshot {
    return {
      selectedIds: [...this.selected],
      controlGroups: {
        1: [...this.groups[1]],
        2: [...this.groups[2]],
        3: [...this.groups[3]],
      },
    };
  }

  isFriendlySelectable(member: TMember): boolean {
    return member.teamId === this.localTeamId && member.alive !== false && member.selectable !== false;
  }

  clearSelection(): readonly string[] {
    this.selected = [];
    return this.selectedIds;
  }

  selectMember(member: TMember | undefined, additive = false): readonly string[] {
    if (!member || !this.isFriendlySelectable(member)) {
      if (!additive) this.selected = [];
      return this.selectedIds;
    }
    this.selected = additive ? uniqueIds([...this.selected, member.id]) : [member.id];
    return this.selectedIds;
  }

  selectByPointerRectangle(
    start: ScreenPoint,
    end: ScreenPoint,
    members: readonly TMember[],
    adapter: ScreenGridAdapter<TMember>,
    additive = false,
    padding = 0,
  ): readonly string[] {
    const rectangle = createPointerRectangle(start, end);
    const inside = uniqueFriendlyMembers(members, (member) => this.isFriendlySelectable(member))
      .filter((member) => pointerRectangleContains(rectangle, adapter.memberScreenPoint(member), padding))
      .map((member) => member.id);
    this.selected = additive ? uniqueIds([...this.selected, ...inside]) : inside;
    return this.selectedIds;
  }

  selectAllFriendly(members: readonly TMember[]): readonly string[] {
    this.selected = uniqueFriendlyMembers(members, (member) => this.isFriendlySelectable(member))
      .map((member) => member.id);
    return this.selectedIds;
  }

  storeControlGroup(slot: ControlGroupSlot): readonly string[] {
    this.groups[slot] = [...this.selected];
    return [...this.groups[slot]];
  }

  recallControlGroup(
    slot: ControlGroupSlot,
    members: readonly TMember[],
    additive = false,
  ): readonly string[] {
    const friendlyById = indexFriendlyMembers(members, (member) => this.isFriendlySelectable(member));
    const recalled = this.groups[slot].filter((id) => friendlyById.has(id));
    this.selected = additive ? uniqueIds([...this.selected, ...recalled]) : recalled;
    return this.selectedIds;
  }

  /** Removes dead, missing, duplicated, or no-longer-friendly members from state. */
  reconcile(members: readonly TMember[]): SquadSelectionSnapshot {
    const friendlyById = indexFriendlyMembers(members, (member) => this.isFriendlySelectable(member));
    this.selected = uniqueIds(this.selected).filter((id) => friendlyById.has(id));
    for (const slot of [1, 2, 3] as const) {
      this.groups[slot] = uniqueIds(this.groups[slot]).filter((id) => friendlyById.has(id));
    }
    return this.snapshot();
  }

  /**
   * Ctrl+A selects all friendly units. Ctrl+1/2/3 stores a group. 1/2/3 recalls;
   * holding Shift adds the recalled group to the current selection.
   */
  handleShortcut(shortcut: SquadShortcut, members: readonly TMember[]): boolean {
    const key = shortcut.key.toLowerCase();
    if (shortcut.ctrlKey && key === "a") {
      this.selectAllFriendly(members);
      return true;
    }
    if (key !== "1" && key !== "2" && key !== "3") return false;
    const slot = Number(key) as ControlGroupSlot;
    if (shortcut.ctrlKey) this.storeControlGroup(slot);
    else this.recallControlGroup(slot, members, shortcut.shiftKey === true);
    return true;
  }
}

/** Returns deterministic local slots for zero through seven units. */
export function generateFormationSlots(
  count: number,
  kind: FormationKind,
  spacing = 1,
): readonly FormationSlot[] {
  if (!Number.isInteger(count) || count < 0 || count > 7) {
    throw new RangeError(`Formation count must be an integer from 0 through 7; received ${count}`);
  }
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError(`Formation spacing must be a positive finite number; received ${spacing}`);
  }
  if (kind === "line") {
    const midpoint = (count - 1) / 2;
    return Array.from({ length: count }, (_, index) => ({
      x: (index - midpoint) * spacing,
      y: 0,
    }));
  }
  if (kind !== "wedge") throw new RangeError(`Unsupported formation kind: ${String(kind)}`);

  const slots: FormationSlot[] = [];
  if (count > 0) slots.push({ x: 0, y: 0 });
  for (let rank = 1; slots.length < count; rank += 1) {
    slots.push({ x: -rank * spacing, y: rank * spacing });
    if (slots.length < count) slots.push({ x: rank * spacing, y: rank * spacing });
  }
  return slots;
}

/**
 * Assigns every unique member to a unique rotated slot without mutating it.
 * Wedge uses the clicked anchor as its forward tip; line is centered on it.
 */
export function assignFormationDestinations<TMember extends FormationMember>(
  members: readonly TMember[],
  anchor: GridPoint,
  options: FormationOptions = {},
): readonly FormationAssignment<TMember>[] {
  assertFinitePoint(anchor, "formation anchor");
  const uniqueMembers = uniqueById(members);
  if (uniqueMembers.length === 0) return [];

  const kind = options.kind ?? "wedge";
  const spacing = options.spacing ?? 1;
  const localSlots = generateFormationSlots(uniqueMembers.length, kind, spacing);
  const centroid = meanPosition(uniqueMembers);
  const forward = normalizeVector(options.forward ?? {
    x: anchor.x - centroid.x,
    y: anchor.y - centroid.y,
  });
  const lateral = { x: -forward.y, y: forward.x };
  const destinations = localSlots.map((slot) => ({
    x: anchor.x + lateral.x * slot.x - forward.x * slot.y,
    y: anchor.y + lateral.y * slot.x - forward.y * slot.y,
  }));

  const unassigned = [...uniqueMembers];
  return destinations.map((destination, slotIndex) => {
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < unassigned.length; index += 1) {
      const distance = squaredDistance(unassigned[index]!.position, destination);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    const [member] = unassigned.splice(closestIndex, 1);
    return { member: member!, memberId: member!.id, slotIndex, destination };
  });
}

export function assignFormationDestinationsFromScreen<TMember extends SquadMember>(
  members: readonly TMember[],
  pointer: ScreenPoint,
  adapter: ScreenGridAdapter<TMember>,
  options: FormationOptions = {},
): readonly FormationAssignment<TMember>[] {
  return assignFormationDestinations(members, adapter.screenToGrid(pointer), options);
}

/** Optional no-framework smoke validator for integration or debug tooling. */
export function validateSquadControls(): readonly string[] {
  const issues: string[] = [];
  const playerOne: SquadMember = { id: "p1", teamId: "player", position: { x: 1, y: 1 } };
  const playerTwo: SquadMember = { id: "p2", teamId: "player", position: { x: 2, y: 2 } };
  const enemy: SquadMember = { id: "e1", teamId: "enemy", position: { x: 1.5, y: 1.5 } };
  const members = [playerOne, playerTwo, playerTwo, enemy] as const;
  const adapter: ScreenGridAdapter<SquadMember> = {
    screenToGrid: (point) => ({ ...point }),
    gridToScreen: (point) => ({ ...point }),
    memberScreenPoint: (member) => ({ ...member.position }),
  };
  const controller = new SquadSelectionController<SquadMember>("player");

  if (controller.selectedIds.length !== 0) issues.push("empty selection must start empty");
  controller.selectByPointerRectangle({ x: 0, y: 0 }, { x: 3, y: 3 }, members, adapter);
  if (controller.selectedIds.join(",") !== "p1,p2") issues.push("rectangle selection must deduplicate friendlies");
  if (controller.selectedIds.includes("e1")) issues.push("enemy must never enter selection");
  controller.selectMember(enemy);
  if (controller.selectedIds.length !== 0) issues.push("enemy click must not select an enemy");
  controller.selectMember(playerOne);
  controller.selectMember(playerTwo, true);
  controller.storeControlGroup(1);
  controller.clearSelection();
  controller.recallControlGroup(1, members);
  if (controller.selectedIds.join(",") !== "p1,p2") issues.push("control group recall must restore unique friendlies");
  controller.handleShortcut({ key: "a", ctrlKey: true }, members);
  if (controller.selectedIds.join(",") !== "p1,p2") issues.push("Ctrl+A must select all unique friendlies");

  const emptyAssignments = assignFormationDestinations([], { x: 5, y: 5 });
  if (emptyAssignments.length !== 0) issues.push("empty squad must produce no formation assignments");
  for (const kind of ["line", "wedge"] as const) {
    for (let count = 1; count <= 7; count += 1) {
      const formationMembers = Array.from({ length: count }, (_, index) => ({
        id: `unit-${index}`,
        position: { x: index * 0.2, y: 0 },
      }));
      const assignments = assignFormationDestinations(formationMembers, { x: 10, y: 10 }, {
        kind,
        spacing: 1,
        forward: { x: 1, y: 0 },
      });
      if (assignments.length !== count) issues.push(`${kind} ${count} must assign every member`);
      if (minimumDestinationSpacing(assignments) < 1 - 1e-9) {
        issues.push(`${kind} ${count} destinations violate minimum spacing`);
      }
    }
  }
  return issues;
}

export function assertSquadControlsValid(): void {
  const issues = validateSquadControls();
  if (issues.length > 0) throw new Error(`Squad controls self-validation failed: ${issues.join("; ")}`);
}

function uniqueFriendlyMembers<TMember extends SquadMember>(
  members: readonly TMember[],
  predicate: (member: TMember) => boolean,
): TMember[] {
  return [...indexFriendlyMembers(members, predicate).values()];
}

function indexFriendlyMembers<TMember extends SquadMember>(
  members: readonly TMember[],
  predicate: (member: TMember) => boolean,
): Map<string, TMember> {
  const result = new Map<string, TMember>();
  for (const member of members) {
    if (predicate(member) && !result.has(member.id)) result.set(member.id, member);
  }
  return result;
}

function uniqueById<TMember extends FormationMember>(members: readonly TMember[]): TMember[] {
  const result = new Map<string, TMember>();
  for (const member of members) {
    assertFinitePoint(member.position, `formation member ${member.id}`);
    if (!result.has(member.id)) result.set(member.id, member);
  }
  return [...result.values()];
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

function meanPosition(members: readonly FormationMember[]): GridPoint {
  const total = members.reduce((sum, member) => ({
    x: sum.x + member.position.x,
    y: sum.y + member.position.y,
  }), { x: 0, y: 0 });
  return { x: total.x / members.length, y: total.y / members.length };
}

function normalizeVector(vector: GridPoint): GridPoint {
  assertFinitePoint(vector, "formation forward vector");
  const length = Math.hypot(vector.x, vector.y);
  return length <= 1e-9 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

function squaredDistance(a: GridPoint, b: GridPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function minimumDestinationSpacing(assignments: readonly FormationAssignment[]): number {
  if (assignments.length < 2) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  for (let left = 0; left < assignments.length; left += 1) {
    for (let right = left + 1; right < assignments.length; right += 1) {
      minimum = Math.min(minimum, Math.sqrt(squaredDistance(
        assignments[left]!.destination,
        assignments[right]!.destination,
      )));
    }
  }
  return minimum;
}

function assertFinitePoint(point: ScreenPoint | GridPoint, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} must contain finite x/y values; received (${point.x}, ${point.y})`);
  }
}
