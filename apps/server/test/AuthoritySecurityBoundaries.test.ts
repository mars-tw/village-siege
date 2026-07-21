import { describe, expect, it } from "vitest";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  type GameCommand,
  type MatchCommandIntent,
  type MatchReplicationFrame,
  type VisibleSnapshot,
} from "@village-siege/shared";
import { MatchAuthority, type MatchParticipant } from "../src/authority/MatchAuthority.js";

const SECURITY_PARTICIPANTS: readonly MatchParticipant[] = [
  { playerId: "player-1", teamId: "allies", name: "Player 1", villageId: "pinehold" },
  { playerId: "player-2", teamId: "allies", name: "Player 2", villageId: "riverstead" },
  { playerId: "player-3", teamId: "hostiles", name: "Player 3", villageId: "highcrag" },
];

const FOG_PARTICIPANTS: readonly MatchParticipant[] = [
  SECURITY_PARTICIPANTS[0]!,
  SECURITY_PARTICIPANTS[2]!,
];

function intent(sequence: number, command: GameCommand, commandId = `secure_command_${sequence}`): MatchCommandIntent {
  return {
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    commandId,
    clientCommandSeq: sequence,
    lastServerTickSeen: 0,
    command,
  };
}

function snapshot(authority: MatchAuthority, playerId: string): VisibleSnapshot {
  const frame = authority.initialFrames().get(playerId);
  if (!frame || frame.kind !== "snapshot") throw new Error(`Missing initial snapshot for ${playerId}`);
  return frame.snapshot;
}

function ownUnitId(authority: MatchAuthority, playerId: string): string {
  const unit = snapshot(authority, playerId).entities.find((entity) => (
    entity.kind === "unit" && entity.ownerId === playerId
  ));
  if (!unit) throw new Error(`Missing owned unit for ${playerId}`);
  return unit.id;
}

function currentCanonicalHash(authority: MatchAuthority): string {
  const record = authority.recoveryRecord();
  return record.journal.at(-1)?.stateHash ?? record.checkpoint.stateHash;
}

function assertNoPrivateAuthorityState(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const privateKey of [
    "aiControllers",
    "visibilityByPlayer",
    "randomState",
    "lastSequence",
    "nextEntityNumber",
    "teamTownCenterLostAt",
    "gatherState",
    "activeAbility",
  ]) {
    expect(serialized).not.toContain(`\"${privateKey}\"`);
  }
}

function assertOwnerControlBelongsOnlyTo(value: unknown, recipientPlayerId: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertOwnerControlBelongsOnlyTo(item, recipientPlayerId);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "ownerControl")) {
    expect(record.kind).toBe("building");
    expect(record.ownerId).toBe(recipientPlayerId);
  }
  for (const nested of Object.values(record)) assertOwnerControlBelongsOnlyTo(nested, recipientPlayerId);
}

function expectFramePrivacy(frame: MatchReplicationFrame, recipientPlayerId: string): void {
  expect(frame.recipientPlayerId).toBe(recipientPlayerId);
  assertNoPrivateAuthorityState(frame);
  assertOwnerControlBelongsOnlyTo(frame, recipientPlayerId);
}

describe("authoritative multiplayer security boundaries", () => {
  it("rejects injected authority identity fields without changing canonical state or recipient views", () => {
    const authority = new MatchAuthority("identity-injection", 7101, SECURITY_PARTICIPANTS);
    const beforeHash = currentCanonicalHash(authority);
    const beforeViews = SECURITY_PARTICIPANTS.map(({ playerId }) => authority.forceSnapshotFrame(playerId));
    const forged = {
      ...intent(0, { type: "stop", entityIds: [ownUnitId(authority, "player-1")] }, "forged_identity_01"),
      playerId: "player-2",
      matchId: "attacker-selected-match",
    };

    expect(authority.submitIntent("player-1", forged)).toMatchObject({
      queued: false,
      result: { accepted: false, code: "INVALID_PAYLOAD" },
    });
    expect(authority.submitIntent("outside-room", intent(0, { type: "surrender" }, "outside_room_0001")))
      .toMatchObject({ queued: false, result: { accepted: false, code: "NOT_ROOM_MEMBER" } });
    expect(currentCanonicalHash(authority)).toBe(beforeHash);
    expect(SECURITY_PARTICIPANTS.map(({ playerId }) => authority.forceSnapshotFrame(playerId))).toEqual(beforeViews);
  });

  it("rejects foreign ownership while producing the same canonical state hash as an idle authority step", () => {
    const attacked = new MatchAuthority("foreign-ownership", 7102, SECURITY_PARTICIPANTS);
    const baseline = new MatchAuthority("foreign-ownership", 7102, SECURITY_PARTICIPANTS);
    attacked.initialFrames();
    baseline.initialFrames();
    const foreignUnitId = ownUnitId(attacked, "player-2");
    const maliciousCommandId = "foreign_owner_0001";

    expect(attacked.submitIntent("player-1", intent(0, {
      type: "stop",
      entityIds: [foreignUnitId],
    }, maliciousCommandId))).toMatchObject({ queued: true });
    const attackedTick = attacked.step();
    baseline.step();

    expect(attackedTick.commandResults.get("player-1")).toEqual([{
      commandId: maliciousCommandId,
      clientCommandSeq: 0,
      accepted: false,
      code: "ENTITY_NOT_OWNED",
      serverTick: 1,
    }]);
    expect(attackedTick.commandResults.get("player-2")).toBeUndefined();
    expect(attackedTick.commandResults.get("player-3")).toBeUndefined();
    expect(currentCanonicalHash(attacked)).toBe(currentCanonicalHash(baseline));
    for (const [playerId, frame] of attackedTick.frames) {
      expect(JSON.stringify(frame)).not.toContain(maliciousCommandId);
      expect(frame.events.some((event) => event.type === "commandAccepted" || event.type === "commandRejected")).toBe(false);
      expectFramePrivacy(frame, playerId);
    }
  });

  it("rejects a direct attack on a fog-hidden target without changing the canonical state hash", () => {
    const attacked = new MatchAuthority("fog-target-rejection", 7103, FOG_PARTICIPANTS);
    const baseline = new MatchAuthority("fog-target-rejection", 7103, FOG_PARTICIPANTS);
    const playerView = snapshot(attacked, "player-1");
    const canonicalState = attacked.recoveryRecord().checkpoint.state;
    const hiddenHostile = canonicalState.entities.find((entity) => (
      entity.ownerId === "player-3" && !playerView.entities.some((visible) => visible.id === entity.id)
    ));
    if (!hiddenHostile) throw new Error("Expected at least one fog-hidden hostile entity");

    attacked.submitIntent("player-1", intent(0, {
      type: "attack",
      entityIds: [ownUnitId(attacked, "player-1")],
      targetId: hiddenHostile.id,
    }, "hidden_target_0001"));
    const attackedTick = attacked.step();
    baseline.step();

    expect(attackedTick.commandResults.get("player-1")).toEqual([
      expect.objectContaining({ accepted: false, code: "TARGET_NOT_VISIBLE" }),
    ]);
    expect(currentCanonicalHash(attacked)).toBe(currentCanonicalHash(baseline));
    for (const frame of attackedTick.frames.values()) {
      if (frame.recipientPlayerId === "player-1") expect(JSON.stringify(frame)).not.toContain(hiddenHostile.id);
    }
  });

  it("keeps snapshots, deltas and world events free of hostile and allied owner-private controls", () => {
    const authority = new MatchAuthority("wire-privacy", 7104, SECURITY_PARTICIPANTS);
    const initial = authority.initialFrames();
    const playerOneFrame = initial.get("player-1");
    if (!playerOneFrame || playerOneFrame.kind !== "snapshot") throw new Error("Missing player-1 snapshot");
    for (const [playerId, frame] of initial) expectFramePrivacy(frame, playerId);
    const alliedBuildings = playerOneFrame.snapshot.entities.filter((entity) => (
      entity.kind === "building" && entity.ownerId === "player-2"
    ));
    expect(alliedBuildings.length).toBeGreaterThan(0);
    expect(alliedBuildings.every((entity) => entity.ownerControl === undefined)).toBe(true);
    expect(playerOneFrame.snapshot.entities
      .filter((entity) => entity.kind === "building" && entity.ownerId === "player-1")
      .every((entity) => entity.ownerControl !== undefined)).toBe(true);

    const fogAuthority = new MatchAuthority("wire-fog-privacy", 7104, FOG_PARTICIPANTS);
    const fogInitial = fogAuthority.initialFrames();
    const fogPlayerOne = fogInitial.get("player-1");
    if (!fogPlayerOne || fogPlayerOne.kind !== "snapshot") throw new Error("Missing fog snapshot");
    const hiddenHostileIds = fogAuthority.recoveryRecord().checkpoint.state.entities
      .filter((entity) => entity.ownerId === "player-3")
      .filter((entity) => !fogPlayerOne.snapshot.entities.some((visible) => visible.id === entity.id))
      .map((entity) => entity.id);
    expect(hiddenHostileIds.length).toBeGreaterThan(0);

    fogAuthority.submitIntent("player-1", intent(0, {
      type: "move",
      entityIds: [ownUnitId(fogAuthority, "player-1")],
      target: { x: 5, y: 5 },
    }, "privacy_move_0001"));
    const tick = fogAuthority.step();
    for (const [playerId, frame] of tick.frames) expectFramePrivacy(frame, playerId);

    const playerOneDelta = tick.frames.get("player-1");
    if (!playerOneDelta || playerOneDelta.kind !== "delta") throw new Error("Expected player-1 delta");
    const publicWire = JSON.stringify(playerOneDelta);
    for (const hiddenId of hiddenHostileIds) expect(publicWire).not.toContain(hiddenId);
    expect(playerOneDelta.events.some((event) => event.type === "commandAccepted" || event.type === "commandRejected"))
      .toBe(false);
  });

  it("isolates accepted command acknowledgements even when players reuse the same command identity", () => {
    const authority = new MatchAuthority("ack-channel-isolation", 7105, SECURITY_PARTICIPANTS);
    const sharedCommandId = "shared_ack_identity";
    authority.submitIntent("player-1", intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-1")],
    }, sharedCommandId));
    authority.submitIntent("player-2", intent(0, {
      type: "stop",
      entityIds: [ownUnitId(authority, "player-2")],
    }, sharedCommandId));

    const tick = authority.step();
    expect([...tick.commandResults.keys()]).toEqual(["player-1", "player-2"]);
    expect(tick.commandResults.get("player-1")).toEqual([expect.objectContaining({
      commandId: sharedCommandId,
      clientCommandSeq: 0,
      accepted: true,
    })]);
    expect(tick.commandResults.get("player-2")).toEqual([expect.objectContaining({
      commandId: sharedCommandId,
      clientCommandSeq: 0,
      accepted: true,
    })]);
    expect(tick.commandResults.get("player-3")).toBeUndefined();
    for (const [playerId, frame] of tick.frames) {
      expect(JSON.stringify(frame)).not.toContain(sharedCommandId);
      expectFramePrivacy(frame, playerId);
    }
  });
});
