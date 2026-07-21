import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  applyVisibleSnapshotDelta,
  isMatchCommandResult,
  isMatchLifecycleMessage,
  isMatchReplicationFrame,
  isMatchServerHello,
  verifyVisibleSnapshotChecksum,
} from "@village-siege/shared";

const SERVER_URL = process.env.COLYSEUS_URL ?? "http://localhost:2567";
const LOBBY_ROOM_NAME = "village_siege_lobby";
const VERSION_OFFER = { protocolVersion: MATCH_PROTOCOL_VERSION, rulesVersion: RULES_VERSION };
const RECONNECTABLE_CLOSE_CODE = 4010;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForSignal(register, label, timeoutMs = 10_000) {
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

function createRoomCode() {
  return [...randomBytes(6)].map((byte) => ALPHABET[byte & 31]).join("");
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

function assertAssignment(assignment) {
  if (!assignment
    || typeof assignment.playerId !== "string"
    || typeof assignment.matchId !== "string"
    || !/^match-[a-f0-9]{32}$/.test(assignment.matchId)
    || typeof assignment.reservation?.roomId !== "string"
    || typeof assignment.reservation?.sessionId !== "string"
    || assignment.reservation.name !== "village_siege_match") {
    throw new Error(`Invalid authoritative match assignment: ${JSON.stringify(assignment)}`);
  }
}

function createRecipientStream(room, assignment, options = {}) {
  let hello;
  let view;
  let streamError;
  let recovering = false;
  let transportReconnected = false;
  let recoverySnapshot;
  let replayStarted = false;
  let suppressCommandResults = false;
  const hellos = [];
  const lifecycle = [];
  const commandResults = [];
  const snapshotTicks = [];

  const fail = (error) => {
    if (!streamError) streamError = error instanceof Error ? error : new Error(String(error));
  };

  room.onMessage("match.lifecycle", (payload) => {
    try {
      if (!isMatchLifecycleMessage(payload)
        || payload.matchId !== assignment.matchId
        || payload.recipientPlayerId !== assignment.playerId
        || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
        || payload.rulesVersion !== RULES_VERSION) {
        throw new Error(`Invalid recovery lifecycle payload: ${JSON.stringify(payload)}`);
      }
      if (payload.type === "failed") throw new Error(`Server recovery failed: ${payload.code}`);
      if (payload.type === "recovering" && payload.leaseExpiresAtEpochMs <= Date.now()) {
        throw new Error("Server announced an already-expired reconnect lease.");
      }
      lifecycle.push(payload);
    } catch (error) {
      fail(error);
    }
  });

  room.onMessage("match.hello", (payload) => {
    try {
      if (!isMatchServerHello(payload)
        || payload.matchId !== assignment.matchId
        || payload.recipientPlayerId !== assignment.playerId
        || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
        || payload.rulesVersion !== RULES_VERSION) {
        throw new Error(`Invalid recovery hello payload: ${JSON.stringify(payload)}`);
      }
      hello = payload;
      hellos.push(payload);
    } catch (error) {
      fail(error);
    }
  });

  room.onMessage("match.commandResult", (payload) => {
    try {
      if (!isMatchCommandResult(payload) || payload.commandId === null) {
        throw new Error(`Invalid command result payload: ${JSON.stringify(payload)}`);
      }
      if (!suppressCommandResults) {
        commandResults.push(payload);
        options.onCommandResult?.(payload);
      }
    } catch (error) {
      fail(error);
    }
  });

  room.onMessage("match.frame", (payload) => {
    try {
      if (!isMatchReplicationFrame(payload)
        || payload.matchId !== assignment.matchId
        || payload.recipientPlayerId !== assignment.playerId
        || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
        || payload.rulesVersion !== RULES_VERSION) {
        throw new Error("Invalid recipient replication frame during recovery smoke.");
      }
      if (payload.kind === "snapshot") {
        if (!verifyVisibleSnapshotChecksum(payload.snapshot)) throw new Error("Snapshot checksum mismatch.");
        view = payload.snapshot;
        snapshotTicks.push(payload.serverTick);
        if (recovering && transportReconnected) {
          recoverySnapshot = payload;
          if (!replayStarted) {
            replayStarted = true;
            options.onRecoverySnapshot?.(payload, [...hellos], [...lifecycle]);
          }
        }
        return;
      }
      if (!view || recovering) return;
      view = applyVisibleSnapshotDelta(view, payload.delta);
    } catch (error) {
      fail(error);
    }
  });

  return {
    get hello() { return hello; },
    get hellos() { return [...hellos]; },
    get view() { return view; },
    get lifecycle() { return [...lifecycle]; },
    get commandResults() { return [...commandResults]; },
    get recoverySnapshot() { return recoverySnapshot; },
    get replayStarted() { return replayStarted; },
    get snapshotTicks() { return [...snapshotTicks]; },
    setSuppressCommandResults(value) { suppressCommandResults = value; },
    beginRecovery() { recovering = true; },
    markTransportReconnected() { transportReconnected = true; },
    finishRecovery() { recovering = false; },
    assertHealthy() { if (streamError) throw streamError; },
  };
}

function forceReconnectableSocketDrop(room) {
  if (!room.connection
    || typeof room.connection.close !== "function"
    || room.connection.isOpen !== true
    || typeof room.reconnectionToken !== "string"
    || room.reconnectionToken.length === 0) {
    throw new Error("Colyseus SDK does not expose an open reconnectable room connection; recovery smoke cannot proceed reliably.");
  }
  room.connection.close(RECONNECTABLE_CLOSE_CODE, "TASK-020 recovery smoke");
}

function ownTownCenterId(view, playerId) {
  const entity = view.entities.find((candidate) => (
    candidate.ownerId === playerId && candidate.kind === "building" && candidate.typeId === "townCenter"
  ));
  if (!entity) throw new Error(`Missing owned town center for ${playerId}.`);
  return entity.id;
}

export async function runMultiplayerRecoverySmoke() {
  const hostClient = new Client(SERVER_URL);
  const guestClient = new Client(SERVER_URL);
  let hostLobby;
  let guestLobby;
  let hostMatch;
  let guestMatch;
  let cleaningUp = false;
  let unexpectedLeave;

  try {
    const roomCode = createRoomCode();
    hostLobby = await hostClient.create(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Recovery host",
      villageId: "pinehold",
      ...VERSION_OFFER,
    });
    guestLobby = await guestClient.join(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Recovery guest",
      villageId: "riverstead",
      ...VERSION_OFFER,
    });
    await waitFor(() => hostLobby.state.players.size === 2, "two-player recovery lobby");

    hostLobby.send("lobby.ready", { ready: true });
    guestLobby.send("lobby.ready", { ready: true });
    await waitFor(
      () => [...hostLobby.state.players.values()].every((player) => player.ready),
      "both recovery players ready",
    );

    const hostAssignmentPromise = waitForSignal(
      (resolve) => hostLobby.onMessage("lobby.matchAssigned", resolve),
      "host recovery assignment",
    );
    const guestAssignmentPromise = waitForSignal(
      (resolve) => guestLobby.onMessage("lobby.matchAssigned", resolve),
      "guest recovery assignment",
    );
    hostLobby.send("lobby.start", {});
    const [hostAssignment, guestAssignment] = await Promise.all([
      hostAssignmentPromise,
      guestAssignmentPromise,
    ]);
    assertAssignment(hostAssignment);
    assertAssignment(guestAssignment);
    if (hostAssignment.matchId !== guestAssignment.matchId) throw new Error("Players received different stable match IDs.");
    if (hostAssignment.reservation.roomId !== guestAssignment.reservation.roomId) {
      throw new Error("Players received different Colyseus match rooms.");
    }

    hostMatch = await hostClient.consumeSeatReservation(hostAssignment.reservation);
    guestMatch = await guestClient.consumeSeatReservation(guestAssignment.reservation);
    const pending = new Map();
    const replayOrder = [];
    const recoveredResults = new Map();
    let hostStream;
    hostStream = createRecipientStream(hostMatch, hostAssignment, {
      onCommandResult(result) {
        const intent = pending.get(result.commandId);
        if (!intent || intent.clientCommandSeq !== result.clientCommandSeq) {
          throw new Error(`Recovery result does not correlate with a pending intent: ${JSON.stringify(result)}`);
        }
        const prior = recoveredResults.get(result.commandId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(result)) {
          throw new Error(`Duplicate command result diverged: ${result.commandId}`);
        }
        recoveredResults.set(result.commandId, result);
        pending.delete(result.commandId);
      },
      onRecoverySnapshot(_frame, hellos, lifecycle) {
        const recovering = lifecycle.find((message) => message.type === "recovering");
        const resumed = lifecycle.find((message) => message.type === "resumed");
        if (!recovering || !resumed || recovering.recoveryEpoch !== resumed.recoveryEpoch) {
          throw new Error("Recovery snapshot arrived without a matched recovering/resumed lifecycle pair.");
        }
        if (hellos.length < 2 || hellos.at(-1).nextClientCommandSeq !== 2) {
          throw new Error(`Recovery hello did not preserve the server command cursor: ${JSON.stringify(hellos.at(-1))}`);
        }
        hostStream.setSuppressCommandResults(false);
        const ordered = [...pending.values()].sort((left, right) => left.clientCommandSeq - right.clientCommandSeq);
        for (const intent of ordered) {
          replayOrder.push(intent.clientCommandSeq);
          hostMatch.send("match.command", intent);
        }
        hostStream.finishRecovery();
      },
    });
    const guestStream = createRecipientStream(guestMatch, guestAssignment);

    let dropCount = 0;
    let reconnectCount = 0;
    hostMatch.reconnection.minUptime = 0;
    hostMatch.reconnection.delay = 1_000;
    hostMatch.reconnection.minDelay = 1_000;
    hostMatch.reconnection.maxDelay = 1_000;
    hostMatch.reconnection.maxRetries = 5;
    hostMatch.reconnection.backoff = () => 1_000;
    hostMatch.onDrop(() => {
      dropCount += 1;
      hostStream.beginRecovery();
    });
    hostMatch.onReconnect(() => {
      reconnectCount += 1;
      hostStream.markTransportReconnected();
    });
    hostMatch.onLeave((code, reason) => {
      if (!cleaningUp) unexpectedLeave = new Error(`Host match left during recovery (${code}): ${reason ?? ""}`);
    });

    hostMatch.send("match.hello", VERSION_OFFER);
    guestMatch.send("match.hello", VERSION_OFFER);
    await waitFor(() => {
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.hello && guestStream.hello && hostStream.view && guestStream.view;
    }, "initial recovery protocol and snapshots");
    await hostLobby.leave().catch(() => undefined);
    hostLobby = undefined;
    await guestLobby.leave().catch(() => undefined);
    guestLobby = undefined;

    const initialView = hostStream.view;
    const foodBefore = initialView.wallet.food;
    const townCenterId = ownTownCenterId(initialView, hostAssignment.playerId);
    const intents = [0, 1, 2].map((sequence) => onlineIntent(
      `recovery_train_${sequence.toString().padStart(4, "0")}`,
      sequence,
      initialView,
      { type: "train", producerId: townCenterId, unitType: "villager", count: 1 },
    ));
    for (const intent of intents) pending.set(intent.commandId, intent);

    // The first two commands reach authority, while their acknowledgements are
    // deliberately left unresolved by the application. The third command is a
    // real drop-before-send pending entry. Recovery must replay all three in
    // sequence without applying the first two twice.
    hostStream.setSuppressCommandResults(true);
    hostMatch.send("match.command", intents[0]);
    hostMatch.send("match.command", intents[1]);
    await waitFor(() => {
      hostStream.assertHealthy();
      return hostStream.view?.wallet.food === foodBefore - 100;
    }, "two authoritative pre-drop resource spends");
    const tickBeforeDrop = hostStream.view.serverTick;
    const guestTickBeforeDrop = guestStream.view.serverTick;

    forceReconnectableSocketDrop(hostMatch);
    await waitFor(() => dropCount === 1, "real host socket drop");
    await waitFor(() => {
      guestStream.assertHealthy();
      return guestStream.view?.serverTick >= guestTickBeforeDrop + 5;
    }, "authoritative ticks continuing while host socket is down");
    await waitFor(() => {
      if (unexpectedLeave) throw unexpectedLeave;
      hostStream.assertHealthy();
      return reconnectCount === 1 && hostStream.recoverySnapshot && hostStream.replayStarted;
    }, "socket reconnect lifecycle, hello, full snapshot and replay", 15_000);
    await waitFor(() => {
      if (unexpectedLeave) throw unexpectedLeave;
      hostStream.assertHealthy();
      return pending.size === 0
        && recoveredResults.size === 3
        && hostStream.view?.serverTick >= Math.max(...[...recoveredResults.values()].map((entry) => entry.serverTick));
    }, "ordered exactly-once pending command completion", 10_000);

    hostStream.assertHealthy();
    guestStream.assertHealthy();
    if (JSON.stringify(replayOrder) !== JSON.stringify([0, 1, 2])) {
      throw new Error(`Pending intents replayed out of order: ${JSON.stringify(replayOrder)}`);
    }
    if ([...recoveredResults.values()].some((result) => !result.accepted)) {
      throw new Error(`A valid recovered command was rejected: ${JSON.stringify([...recoveredResults.values()])}`);
    }
    const recoverySnapshotTick = hostStream.recoverySnapshot.serverTick;
    if (recoverySnapshotTick < tickBeforeDrop || hostStream.view.serverTick <= tickBeforeDrop) {
      throw new Error("Recovered snapshot or final view did not continue the authoritative tick.");
    }
    const priorResults = [recoveredResults.get(intents[0].commandId), recoveredResults.get(intents[1].commandId)];
    const newResult = recoveredResults.get(intents[2].commandId);
    if (priorResults.some((entry) => !entry || entry.serverTick > tickBeforeDrop)
      || !newResult
      || newResult.serverTick <= tickBeforeDrop) {
      throw new Error(`Recovery did not replay immutable pre-drop results before accepting the unsent command: ${JSON.stringify([...recoveredResults.values()])}`);
    }
    const recoveryFoodBeforeReplay = hostStream.recoverySnapshot.snapshot.wallet.food;
    const recoveryPhaseNetFoodSpend = recoveryFoodBeforeReplay - hostStream.view.wallet.food;
    // Passive gather deposits can make the net spend smaller than the 50-food
    // command cost. A value greater than 50 proves a pre-drop command was
    // charged again during replay.
    if (recoveryPhaseNetFoodSpend > 50) {
      throw new Error(`Recovered commands spent food more than once: ${recoveryPhaseNetFoodSpend}`);
    }
    const recoveryLifecycle = hostStream.lifecycle.filter((message) => message.recoveryEpoch > 0);
    const result = {
      result: "PASS",
      roomCode,
      matchId: hostAssignment.matchId,
      matchRoomId: hostMatch.roomId,
      socketDrops: dropCount,
      socketReconnects: reconnectCount,
      tickBeforeDrop,
      recoverySnapshotTick,
      finalServerTick: hostStream.view.serverTick,
      checks: {
        realSocketDrop: true,
        reconnectLifecycle: recoveryLifecycle.map((message) => message.type),
        recoveryEpoch: recoveryLifecycle[0]?.recoveryEpoch,
        recoveryHelloCursor: hostStream.hellos.at(-1)?.nextClientCommandSeq,
        fullSnapshotRecovery: hostStream.recoverySnapshot.kind,
        orderedPendingReplay: replayOrder,
        recoveredCommandResults: recoveredResults.size,
        immutablePreDropResultTicks: priorResults.map((entry) => entry.serverTick),
        newlyAcceptedResultTick: newResult.serverTick,
        authoritativeTickContinued: hostStream.view.serverTick - tickBeforeDrop,
        recoveryPhaseNetFoodSpend,
        recoveryPhaseMaximumExpectedFoodSpend: 50,
        duplicateResourceSpend: false,
      },
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    cleaningUp = true;
    await guestMatch?.leave().catch(() => undefined);
    await hostMatch?.leave().catch(() => undefined);
    await guestLobby?.leave().catch(() => undefined);
    await hostLobby?.leave().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runMultiplayerRecoverySmoke();
}
