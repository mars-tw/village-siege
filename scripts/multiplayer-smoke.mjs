import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@colyseus/sdk";

const SERVER_URL = process.env.COLYSEUS_URL ?? "http://localhost:2567";
const LOBBY_ROOM_NAME = "village_siege_lobby";
const MATCH_ROOM_NAME = "village_siege_match";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForSignal(register, label, timeoutMs = 8_000) {
  let timeout;
  try {
    return await Promise.race([
      new Promise((resolve) => register(resolve)),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function expectMessage(room, type, predicate, label, send) {
  let removeListener = () => undefined;
  try {
    const pending = waitForSignal((resolve) => {
      removeListener = room.onMessage(type, (payload) => {
        if (predicate(payload)) resolve(payload);
      });
    }, label);
    send();
    return await pending;
  } finally {
    removeListener();
  }
}

async function expectLobbyError(room, expectedCode, send) {
  return expectMessage(
    room,
    "lobby.error",
    (payload) => payload?.code === expectedCode,
    `lobby rejection ${expectedCode}`,
    send,
  );
}

async function expectCommandResult(room, predicate, label, send) {
  return expectMessage(room, "match.commandResult", predicate, label, send);
}

function createRoomCode() {
  return [...randomBytes(6)].map((byte) => ALPHABET[byte & 31]).join("");
}

export async function runMultiplayerSmoke() {
  const hostClient = new Client(SERVER_URL);
  const guestClient = new Client(SERVER_URL);
  let hostLobby;
  let guestLobby;
  let hostMatch;
  let guestMatch;

  try {
    await expectPublicMatchCreationRejected();
    const roomCode = createRoomCode();
    hostLobby = await hostClient.create(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Host smoke test",
      villageId: "pinehold",
    });
    guestLobby = await guestClient.join(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Guest smoke test",
      villageId: "riverstead",
    });

    await waitFor(() => hostLobby.state.players.size === 2, "two-player lobby roster");
    await expectLobbyError(guestLobby, "HOST_ONLY", () => guestLobby.send("lobby.start", {}));
    await expectLobbyError(hostLobby, "PLAYERS_NOT_READY", () => hostLobby.send("lobby.start", {}));
    await expectLobbyError(guestLobby, "INVALID_PAYLOAD", () => guestLobby.send("lobby.ready", { ready: "yes" }));

    hostLobby.send("lobby.ready", { ready: true });
    guestLobby.send("lobby.ready", { ready: true });
    await waitFor(
      () => [...hostLobby.state.players.values()].every((player) => player.ready),
      "both lobby players ready",
    );

    const hostAssignmentPromise = waitForSignal(
      (resolve) => hostLobby.onMessage("lobby.matchAssigned", resolve),
      "host match assignment",
    );
    const guestAssignmentPromise = waitForSignal(
      (resolve) => guestLobby.onMessage("lobby.matchAssigned", resolve),
      "guest match assignment",
    );
    hostLobby.send("lobby.start", {});
    const [hostAssignment, guestAssignment] = await Promise.all([
      hostAssignmentPromise,
      guestAssignmentPromise,
    ]);
    if (hostAssignment.reservation.roomId !== guestAssignment.reservation.roomId) throw new Error("Lobby assigned different match rooms.");
    if (hostAssignment.playerId === guestAssignment.playerId) throw new Error("Lobby assigned duplicate player identities.");
    if (hostAssignment.reservation.sessionId === guestAssignment.reservation.sessionId) throw new Error("Lobby assigned duplicate match seats.");
    if (hostAssignment.reservation.roomId === hostLobby.roomId) throw new Error("Lobby and match were not split.");
    await expectUnreservedJoinRejected(hostAssignment.reservation.roomId);

    hostMatch = await hostClient.consumeSeatReservation(hostAssignment.reservation);
    let hostFrame;
    hostMatch.onMessage("match.frame", (frame) => { hostFrame = frame; });
    guestMatch = await guestClient.consumeSeatReservation(guestAssignment.reservation);
    let guestFrame;
    guestMatch.onMessage("match.frame", (frame) => { guestFrame = frame; });
    await waitFor(
      () => hostFrame?.snapshot?.serverTick >= 2 && guestFrame?.snapshot?.serverTick >= 2,
      "recipient authoritative frames",
    );

    assertSafeFrame(hostFrame, hostAssignment, hostMatch.roomId);
    assertSafeFrame(guestFrame, guestAssignment, guestMatch.roomId);
    const guestTownId = guestFrame.snapshot.entities.find((entity) => (
      entity.ownerId === guestAssignment.playerId && entity.kind === "building" && entity.typeId === "townCenter"
    ))?.id;
    if (!guestTownId) throw new Error("Guest did not receive its own town center.");
    if (hostFrame.snapshot.entities.some((entity) => entity.id === guestTownId)) {
      throw new Error("Host frame leaked the guest town center through fog.");
    }

    const hostUnitId = ownEntityId(hostFrame, hostAssignment.playerId, "unit");
    const guestUnitId = ownEntityId(guestFrame, guestAssignment.playerId, "unit");
    const [hostAck, guestAck] = await Promise.all([
      expectCommandResult(
        hostMatch,
        (payload) => payload?.sequence === 0,
        "host sequence-zero acknowledgement",
        () => hostMatch.send("match.command", {
          sequence: 0,
          clientTick: hostFrame.snapshot.serverTick,
          command: { type: "stop", entityIds: [hostUnitId] },
        }),
      ),
      expectCommandResult(
        guestMatch,
        (payload) => payload?.sequence === 0,
        "guest sequence-zero acknowledgement",
        () => guestMatch.send("match.command", {
          sequence: 0,
          clientTick: guestFrame.snapshot.serverTick,
          command: { type: "stop", entityIds: [guestUnitId] },
        }),
      ),
    ]);
    if (!hostAck.accepted || !guestAck.accepted) throw new Error("Valid same-sequence commands were rejected.");

    const forged = await expectCommandResult(
      hostMatch,
      (payload) => payload?.sequence === 1,
      "forged ownership rejection",
      () => hostMatch.send("match.command", {
        sequence: 1,
        clientTick: hostFrame.snapshot.serverTick,
        command: { type: "stop", entityIds: [guestUnitId] },
      }),
    );
    if (forged.accepted !== false || forged.code !== "ENTITY_NOT_OWNED") {
      throw new Error(`Expected ENTITY_NOT_OWNED, received ${JSON.stringify(forged)}.`);
    }

    const invalid = await expectCommandResult(
      guestMatch,
      (payload) => payload?.code === "INVALID_PAYLOAD",
      "authority field injection rejection",
      () => guestMatch.send("match.command", {
        sequence: 1,
        clientTick: guestFrame.snapshot.serverTick,
        playerId: hostAssignment.playerId,
        command: { type: "stop", entityIds: [guestUnitId] },
      }),
    );
    if (invalid.accepted !== false) throw new Error("Injected authority fields were not rejected.");

    const hostTownId = ownTownCenterId(hostFrame, hostAssignment.playerId);
    const foodBefore = hostFrame.snapshot.wallet.food;
    const trained = await expectCommandResult(
      hostMatch,
      (payload) => payload?.sequence === 2,
      "server-side training acceptance",
      () => hostMatch.send("match.command", {
        sequence: 2,
        clientTick: hostFrame.snapshot.serverTick,
        command: { type: "train", producerId: hostTownId, unitType: "villager", count: 1 },
      }),
    );
    if (!trained.accepted) throw new Error(`Training was rejected: ${JSON.stringify(trained)}.`);
    await waitFor(() => hostFrame.snapshot.wallet.food < foodBefore, "authoritative resource spend");

    const stateKeys = Object.keys(hostMatch.state.toJSON()).sort();
    if (JSON.stringify(stateKeys) !== JSON.stringify(["matchId", "phase", "serverTick"])) {
      throw new Error(`Match schema exposed unexpected authority fields: ${stateKeys.join(", ")}`);
    }

    const result = {
      result: "PASS",
      roomCode,
      lobbyRoomId: hostLobby.roomId,
      matchRoomId: hostMatch.roomId,
      players: 2,
      serverTick: hostFrame.snapshot.serverTick,
      checks: {
        publicMatchCreationRejected: true,
        splitRooms: true,
        privateSeatHandoff: true,
        unreservedSeatTheftRejected: true,
        recipientFilteredFrames: true,
        sameSequenceAckIsolation: true,
        forgedOwnershipRejected: forged.code,
        injectedAuthorityRejected: invalid.code,
        authoritativeResourceSpend: foodBefore - hostFrame.snapshot.wallet.food,
        canonicalStateNotSerialized: true,
      },
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await guestMatch?.leave().catch(() => undefined);
    await hostMatch?.leave().catch(() => undefined);
    await guestLobby?.leave().catch(() => undefined);
    await hostLobby?.leave().catch(() => undefined);
  }
}

async function expectPublicMatchCreationRejected() {
  const client = new Client(SERVER_URL);
  try {
    const room = await client.create(MATCH_ROOM_NAME, {});
    await room.leave().catch(() => undefined);
    throw new Error("Public client created an authoritative match without a launch capability.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Public client created")) throw error;
    if (!(error instanceof Error) || !/^[A-Za-z0-9_-]+ is already full\.$/.test(error.message)) {
      throw new Error(`Unexpected public-match rejection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function expectUnreservedJoinRejected(roomId) {
  const client = new Client(SERVER_URL);
  try {
    const room = await client.joinById(roomId, {});
    await room.leave().catch(() => undefined);
    throw new Error("Unreserved client entered the locked authoritative match.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unreserved client entered")) throw error;
    const expected = new RegExp(`^room "${roomId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is locked$`);
    if (!(error instanceof Error) || !expected.test(error.message)) {
      throw new Error(`Unexpected unreserved-seat rejection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function assertSafeFrame(frame, assignment, matchId) {
  if (frame.snapshot.matchId !== matchId) throw new Error("Frame match identity mismatch.");
  if (frame.snapshot.recipientPlayerId !== assignment.playerId) throw new Error("Frame recipient identity mismatch.");
  const serialized = JSON.stringify(frame);
  for (const forbidden of ["accessToken", "aiControllers", "productionQueue", "randomState"]) {
    if (serialized.includes(forbidden)) throw new Error(`Recipient frame leaked ${forbidden}.`);
  }
}

function ownEntityId(frame, playerId, kind) {
  const entity = frame.snapshot.entities.find((candidate) => candidate.ownerId === playerId && candidate.kind === kind);
  if (!entity) throw new Error(`Missing owned ${kind} for ${playerId}.`);
  return entity.id;
}

function ownTownCenterId(frame, playerId) {
  const entity = frame.snapshot.entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "building" && candidate.typeId === "townCenter"
  ));
  if (!entity) throw new Error(`Missing owned town center for ${playerId}.`);
  return entity.id;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runMultiplayerSmoke();
}
