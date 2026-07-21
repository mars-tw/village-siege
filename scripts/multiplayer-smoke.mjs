import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  applyVisibleSnapshotDelta,
  isMatchReplicationFrame,
  isMatchServerHello,
  verifyVisibleSnapshotChecksum,
} from "@village-siege/shared";

const SERVER_URL = process.env.COLYSEUS_URL ?? "http://localhost:2567";
const LOBBY_ROOM_NAME = "village_siege_lobby";
const MATCH_ROOM_NAME = "village_siege_match";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERSION_OFFER = { protocolVersion: MATCH_PROTOCOL_VERSION, rulesVersion: RULES_VERSION };

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

function createRecipientStream(room, assignment) {
  let hello;
  let view;
  let latestFrame;
  let streamError;
  let sawDelta = false;
  let lastSnapshotTick = -1;
  let dropNextDelta = false;
  let resyncNeeded = false;

  room.onMessage("match.hello", (payload) => {
    if (!isMatchServerHello(payload)
      || payload.matchId !== assignment.matchId
      || payload.recipientPlayerId !== assignment.playerId
      || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
      || payload.rulesVersion !== RULES_VERSION) {
      streamError = new Error("Invalid match hello tuple.");
      return;
    }
    hello = payload;
  });
  room.onMessage("match.frame", (payload) => {
    if (!isMatchReplicationFrame(payload)
      || payload.matchId !== assignment.matchId
      || payload.recipientPlayerId !== assignment.playerId
      || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
      || payload.rulesVersion !== RULES_VERSION) {
      streamError = new Error("Invalid recipient replication frame.");
      return;
    }
    try {
      if (payload.kind === "snapshot") {
        if (!verifyVisibleSnapshotChecksum(payload.snapshot)) throw new Error("Snapshot checksum mismatch.");
        view = payload.snapshot;
        lastSnapshotTick = payload.serverTick;
        resyncNeeded = false;
      } else {
        sawDelta = true;
        if (dropNextDelta) {
          dropNextDelta = false;
          return;
        }
        if (!view || resyncNeeded) return;
        try {
          view = applyVisibleSnapshotDelta(view, payload.delta);
        } catch {
          resyncNeeded = true;
          return;
        }
      }
      latestFrame = payload;
    } catch (error) {
      streamError = error instanceof Error ? error : new Error(String(error));
    }
  });
  return {
    get hello() { return hello; },
    get view() { return view; },
    get latestFrame() { return latestFrame; },
    get sawDelta() { return sawDelta; },
    get lastSnapshotTick() { return lastSnapshotTick; },
    get resyncNeeded() { return resyncNeeded; },
    assertHealthy() { if (streamError) throw streamError; },
    dropOneDelta() { dropNextDelta = true; },
  };
}

function onlineIntent(commandId, clientCommandSeq, view, command) {
  return {
    protocolVersion: MATCH_PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    commandId,
    clientCommandSeq,
    lastServerTickSeen: view.serverTick,
    command,
  };
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
      ...VERSION_OFFER,
    });
    guestLobby = await guestClient.join(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Guest smoke test",
      villageId: "riverstead",
      ...VERSION_OFFER,
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
    if (hostAssignment.matchId !== guestAssignment.matchId || !/^match-[a-f0-9]{32}$/.test(hostAssignment.matchId)) {
      throw new Error("Lobby assigned an invalid or inconsistent durable match identity.");
    }
    if (hostAssignment.playerId === guestAssignment.playerId) throw new Error("Lobby assigned duplicate player identities.");
    if (hostAssignment.reservation.sessionId === guestAssignment.reservation.sessionId) throw new Error("Lobby assigned duplicate match seats.");
    if (hostAssignment.reservation.roomId === hostLobby.roomId) throw new Error("Lobby and match were not split.");
    await expectUnreservedJoinRejected(hostAssignment.reservation.roomId);

    hostMatch = await hostClient.consumeSeatReservation(hostAssignment.reservation);
    const hostStream = createRecipientStream(hostMatch, hostAssignment);
    guestMatch = await guestClient.consumeSeatReservation(guestAssignment.reservation);
    const guestStream = createRecipientStream(guestMatch, guestAssignment);
    hostMatch.send("match.hello", VERSION_OFFER);
    guestMatch.send("match.hello", VERSION_OFFER);
    await waitFor(() => {
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.hello && guestStream.hello && hostStream.view && guestStream.view;
    }, "protocol hello and initial filtered snapshots");
    await waitFor(() => hostStream.view.serverTick >= 2 && guestStream.view.serverTick >= 2, "recipient delta streams");

    assertSafeView(hostStream.view, hostAssignment, hostAssignment.matchId);
    assertSafeView(guestStream.view, guestAssignment, guestAssignment.matchId);
    const guestTownId = guestStream.view.entities.find((entity) => (
      entity.ownerId === guestAssignment.playerId && entity.kind === "building" && entity.typeId === "townCenter"
    ))?.id;
    if (!guestTownId) throw new Error("Guest did not receive its own town center.");
    if (hostStream.view.entities.some((entity) => entity.id === guestTownId)) {
      throw new Error("Host frame leaked the guest town center through fog.");
    }

    hostStream.dropOneDelta();
    await waitFor(() => hostStream.resyncNeeded, "intentional delta gap detection");
    await expectMessage(
      hostMatch,
      "match.frame",
      (payload) => payload?.kind === "snapshot" && payload?.recipientPlayerId === hostAssignment.playerId,
      "full snapshot resynchronization",
      () => hostMatch.send("match.syncRequest", VERSION_OFFER),
    );
    await waitFor(() => !hostStream.resyncNeeded, "resynchronized host stream");

    const hostUnitId = ownEntityId(hostStream.view, hostAssignment.playerId, "unit");
    const guestUnitId = ownEntityId(guestStream.view, guestAssignment.playerId, "unit");
    const [hostAck, guestAck] = await Promise.all([
      expectCommandResult(
        hostMatch,
        (payload) => payload?.commandId === "host_stop_000001",
        "host sequence-zero acknowledgement",
        () => hostMatch.send("match.command", onlineIntent(
          "host_stop_000001",
          0,
          hostStream.view,
          { type: "stop", entityIds: [hostUnitId] },
        )),
      ),
      expectCommandResult(
        guestMatch,
        (payload) => payload?.commandId === "guest_stop_00001",
        "guest sequence-zero acknowledgement",
        () => guestMatch.send("match.command", onlineIntent(
          "guest_stop_00001",
          0,
          guestStream.view,
          { type: "stop", entityIds: [guestUnitId] },
        )),
      ),
    ]);
    if (!hostAck.accepted || !guestAck.accepted) throw new Error("Valid same-sequence commands were rejected.");

    const forged = await expectCommandResult(
      hostMatch,
      (payload) => payload?.commandId === "host_forge_00001",
      "forged ownership rejection",
      () => hostMatch.send("match.command", onlineIntent(
        "host_forge_00001",
        1,
        hostStream.view,
        { type: "stop", entityIds: [guestUnitId] },
      )),
    );
    if (forged.accepted !== false || forged.code !== "ENTITY_NOT_OWNED") {
      throw new Error(`Expected ENTITY_NOT_OWNED, received ${JSON.stringify(forged)}.`);
    }

    const invalidPayload = {
      ...onlineIntent(
        "guest_bad_000001",
        1,
        guestStream.view,
        { type: "stop", entityIds: [guestUnitId] },
      ),
      playerId: hostAssignment.playerId,
    };
    const invalid = await expectCommandResult(
      guestMatch,
      (payload) => payload?.commandId === "guest_bad_000001",
      "authority field injection rejection",
      () => guestMatch.send("match.command", invalidPayload),
    );
    if (invalid.accepted !== false || invalid.code !== "INVALID_PAYLOAD") {
      throw new Error(`Expected INVALID_PAYLOAD, received ${JSON.stringify(invalid)}.`);
    }

    const hostTownId = ownTownCenterId(hostStream.view, hostAssignment.playerId);
    const foodBefore = hostStream.view.wallet.food;
    const trainIntent = onlineIntent(
      "host_train_00001",
      2,
      hostStream.view,
      { type: "train", producerId: hostTownId, unitType: "villager", count: 1 },
    );
    const trained = await expectCommandResult(
      hostMatch,
      (payload) => payload?.commandId === trainIntent.commandId,
      "server-side training acceptance",
      () => hostMatch.send("match.command", trainIntent),
    );
    if (!trained.accepted) throw new Error(`Training was rejected: ${JSON.stringify(trained)}.`);
    await waitFor(() => hostStream.view.wallet.food === foodBefore - 50, "authoritative resource spend");
    const foodAfter = hostStream.view.wallet.food;
    const replayed = await expectCommandResult(
      hostMatch,
      (payload) => payload?.commandId === trainIntent.commandId,
      "deduplicated training result replay",
      () => hostMatch.send("match.command", trainIntent),
    );
    if (JSON.stringify(replayed) !== JSON.stringify(trained)) throw new Error("Duplicate command did not replay the immutable result.");
    await sleep(250);
    if (hostStream.view.wallet.food !== foodAfter) throw new Error("Duplicate training command spent resources twice.");

    await waitFor(() => hostStream.lastSnapshotTick >= 50 && guestStream.lastSnapshotTick >= 50, "five-second periodic snapshots", 10_000);
    if (!hostStream.sawDelta || !guestStream.sawDelta) throw new Error("Recipient streams did not deliver filtered deltas.");

    const lobbyStateKeys = Object.keys(hostLobby.state.toJSON()).sort();
    if (lobbyStateKeys.includes("seed")) throw new Error("Lobby schema exposed the private match seed.");
    const stateKeys = Object.keys(hostMatch.state.toJSON()).sort();
    if (JSON.stringify(stateKeys) !== JSON.stringify(["matchId", "phase", "serverTick"])) {
      throw new Error(`Match schema exposed unexpected authority fields: ${stateKeys.join(", ")}`);
    }

    const result = {
      result: "PASS",
      roomCode,
      lobbyRoomId: hostLobby.roomId,
      matchRoomId: hostMatch.roomId,
      durableMatchId: hostAssignment.matchId,
      players: 2,
      serverTick: hostStream.view.serverTick,
      checks: {
        exactVersionNegotiation: true,
        splitRooms: true,
        privateSeatHandoff: true,
        unreservedSeatTheftRejected: true,
        filteredDeltaChain: true,
        deltaGapFullResync: true,
        fiveSecondSnapshot: hostStream.lastSnapshotTick,
        sameSequenceAckIsolation: true,
        forgedOwnershipRejected: forged.code,
        injectedAuthorityRejected: invalid.code,
        duplicateCommandAppliedOnce: foodBefore - hostStream.view.wallet.food,
        canonicalStateNotSerialized: true,
        privateSeedNotSerialized: true,
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
    const room = await client.create(MATCH_ROOM_NAME, VERSION_OFFER);
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
    const room = await client.joinById(roomId, VERSION_OFFER);
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

function assertSafeView(view, assignment, matchId) {
  if (view.matchId !== matchId) throw new Error("Frame match identity mismatch.");
  if (view.recipientPlayerId !== assignment.playerId) throw new Error("Frame recipient identity mismatch.");
  if (!verifyVisibleSnapshotChecksum(view)) throw new Error("Visible snapshot checksum mismatch.");
  const serialized = JSON.stringify(view);
  for (const forbidden of ["accessToken", "aiControllers", "productionQueue", "randomState", "canonicalHash"]) {
    if (serialized.includes(forbidden)) throw new Error(`Recipient frame leaked ${forbidden}.`);
  }
}

function ownEntityId(view, playerId, kind) {
  const entity = view.entities.find((candidate) => candidate.ownerId === playerId && candidate.kind === kind);
  if (!entity) throw new Error(`Missing owned ${kind} for ${playerId}.`);
  return entity.id;
}

function ownTownCenterId(view, playerId) {
  const entity = view.entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "building" && candidate.typeId === "townCenter"
  ));
  if (!entity) throw new Error(`Missing owned town center for ${playerId}.`);
  return entity.id;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runMultiplayerSmoke();
}
