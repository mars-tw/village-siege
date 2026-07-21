import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  MATCH_PROTOCOL_VERSION,
  RULES_VERSION,
  applyVisibleSnapshotDelta,
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
const RECEIVE_LATENCY_MILLISECONDS = [50, 100, 200];
const IMPAIRMENT_SAMPLE_DELTAS = 50;
const DROPPED_DELTA_ORDINAL = 25;

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

/**
 * Keeps two independent reconstructions for one real Colyseus recipient:
 * a zero-impairment reference and a deterministic adverse-delivery stream.
 * Exactly one delta in each 50-delta sample is dropped (2%). A repeating
 * 50/100/200 ms receive schedule forces later frames to overtake earlier ones.
 * Recovery is accepted only when both reconstructions converge at the same
 * tick and checksum.
 */
function createAdverseRecipientStream(room, assignment) {
  let hello;
  let referenceView;
  let adverseView;
  let streamError;
  let impairmentEnabled = false;
  let impairmentGeneration = 0;
  let deltaOrdinal = 0;
  let droppedDeltaCount = 0;
  let reorderedDeliveryCount = 0;
  let gapDetectionCount = 0;
  let ignoredWhileDesynchronized = 0;
  let highestDeliveredTick = -1;
  let awaitingRecoverySnapshot = false;
  let snapshotCount = 0;
  let recoverySnapshotCount = 0;
  const scheduled = new Set();
  const lifecycle = [];

  const fail = (error) => {
    if (!streamError) streamError = error instanceof Error ? error : new Error(String(error));
  };

  const validateFrame = (payload) => {
    if (!isMatchReplicationFrame(payload)
      || payload.matchId !== assignment.matchId
      || payload.recipientPlayerId !== assignment.playerId
      || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
      || payload.rulesVersion !== RULES_VERSION) {
      throw new Error(`Invalid recipient frame: ${JSON.stringify(payload)}`);
    }
  };

  const applyReference = (frame) => {
    if (frame.kind === "snapshot") {
      if (!verifyVisibleSnapshotChecksum(frame.snapshot)) throw new Error("Reference snapshot checksum mismatch.");
      referenceView = frame.snapshot;
      return;
    }
    if (awaitingRecoverySnapshot || !referenceView) return;
    referenceView = applyVisibleSnapshotDelta(referenceView, frame.delta);
  };

  const applyAdverse = (frame) => {
    if (frame.serverTick < highestDeliveredTick) reorderedDeliveryCount += 1;
    highestDeliveredTick = Math.max(highestDeliveredTick, frame.serverTick);
    if (frame.kind === "snapshot") {
      if (!verifyVisibleSnapshotChecksum(frame.snapshot)) throw new Error("Adverse snapshot checksum mismatch.");
      snapshotCount += 1;
      adverseView = frame.snapshot;
      if (awaitingRecoverySnapshot) {
        recoverySnapshotCount += 1;
        awaitingRecoverySnapshot = false;
      }
      return;
    }
    if (!adverseView) return;
    try {
      adverseView = applyVisibleSnapshotDelta(adverseView, frame.delta);
    } catch {
      gapDetectionCount += 1;
      adverseView = undefined;
    }
  };

  const deliverLater = (frame, delay, generation) => {
    const timer = setTimeout(() => {
      scheduled.delete(timer);
      if (generation !== impairmentGeneration) {
        ignoredWhileDesynchronized += 1;
        return;
      }
      try {
        applyAdverse(frame);
      } catch (error) {
        fail(error);
      }
    }, delay);
    scheduled.add(timer);
  };

  room.onMessage("match.lifecycle", (payload) => {
    try {
      if (!isMatchLifecycleMessage(payload)
        || payload.matchId !== assignment.matchId
        || payload.recipientPlayerId !== assignment.playerId
        || payload.protocolVersion !== MATCH_PROTOCOL_VERSION
        || payload.rulesVersion !== RULES_VERSION) {
        throw new Error(`Invalid adverse-network lifecycle payload: ${JSON.stringify(payload)}`);
      }
      if (payload.type === "failed") throw new Error(`Server recovery failed: ${payload.code}`);
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
        throw new Error(`Invalid adverse-network hello: ${JSON.stringify(payload)}`);
      }
      hello = payload;
    } catch (error) {
      fail(error);
    }
  });

  room.onMessage("match.frame", (payload) => {
    try {
      validateFrame(payload);
      applyReference(payload);
      if (!impairmentEnabled || payload.kind === "snapshot") {
        applyAdverse(payload);
        return;
      }
      deltaOrdinal += 1;
      if (deltaOrdinal === DROPPED_DELTA_ORDINAL) {
        droppedDeltaCount += 1;
        return;
      }
      const delay = RECEIVE_LATENCY_MILLISECONDS[(deltaOrdinal - 1) % RECEIVE_LATENCY_MILLISECONDS.length];
      deliverLater(payload, delay, impairmentGeneration);
    } catch (error) {
      fail(error);
    }
  });

  return {
    get hello() { return hello; },
    get referenceView() { return referenceView; },
    get adverseView() { return adverseView; },
    get droppedDeltaCount() { return droppedDeltaCount; },
    get observedImpairedDeltas() { return deltaOrdinal; },
    get reorderedDeliveryCount() { return reorderedDeliveryCount; },
    get gapDetectionCount() { return gapDetectionCount; },
    get ignoredWhileDesynchronized() { return ignoredWhileDesynchronized; },
    get lifecycle() { return [...lifecycle]; },
    get snapshotCount() { return snapshotCount; },
    get recoverySnapshotCount() { return recoverySnapshotCount; },
    enableImpairment() {
      impairmentEnabled = true;
      deltaOrdinal = 0;
      highestDeliveredTick = adverseView?.serverTick ?? -1;
    },
    disableImpairment() {
      impairmentEnabled = false;
      impairmentGeneration += 1;
      for (const timer of scheduled) clearTimeout(timer);
      ignoredWhileDesynchronized += scheduled.size;
      scheduled.clear();
    },
    beginTransportRecovery() {
      awaitingRecoverySnapshot = true;
      adverseView = undefined;
    },
    isConverged() {
      return Boolean(
        referenceView
        && adverseView
        && referenceView.serverTick === adverseView.serverTick
        && referenceView.checksum === adverseView.checksum,
      );
    },
    assertHealthy() {
      if (streamError) throw streamError;
    },
    dispose() {
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
    },
  };
}

function forceReconnectableSocketDrop(room) {
  if (!room.connection
    || typeof room.connection.close !== "function"
    || room.connection.isOpen !== true
    || typeof room.reconnectionToken !== "string"
    || room.reconnectionToken.length === 0) {
    throw new Error("Colyseus SDK does not expose an open reconnectable connection.");
  }
  room.connection.close(RECONNECTABLE_CLOSE_CODE, "TASK-022 adverse-network smoke");
}

export async function runMultiplayerAdverseSmoke() {
  const hostClient = new Client(SERVER_URL);
  const guestClient = new Client(SERVER_URL);
  let hostLobby;
  let guestLobby;
  let hostMatch;
  let guestMatch;
  let hostStream;
  let guestStream;
  let cleaningUp = false;
  let unexpectedLeave;

  try {
    const roomCode = createRoomCode();
    hostLobby = await hostClient.create(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Adverse host",
      villageId: "pinehold",
      ...VERSION_OFFER,
    });
    guestLobby = await guestClient.join(LOBBY_ROOM_NAME, {
      roomCode,
      playerName: "Adverse guest",
      villageId: "riverstead",
      ...VERSION_OFFER,
    });
    await waitFor(() => hostLobby.state.players.size === 2, "two-player adverse lobby");
    hostLobby.send("lobby.ai.configure", {
      slots: [
        { personality: "aggressor", difficulty: "standard", villageId: "highcrag" },
        { personality: "guardian", difficulty: "standard", villageId: "pinehold" },
        { personality: "raider", difficulty: "standard", villageId: "riverstead" },
      ],
    });
    await waitFor(() => hostLobby.state.aiSlots?.size === 3, "three adverse server-owned AI slots");

    hostLobby.send("lobby.ready", { ready: true });
    guestLobby.send("lobby.ready", { ready: true });
    await waitFor(
      () => [...hostLobby.state.players.values()].every((player) => player.ready),
      "both adverse players ready",
    );

    const hostAssignmentPromise = waitForSignal(
      (resolve) => hostLobby.onMessage("lobby.matchAssigned", resolve),
      "host adverse assignment",
    );
    const guestAssignmentPromise = waitForSignal(
      (resolve) => guestLobby.onMessage("lobby.matchAssigned", resolve),
      "guest adverse assignment",
    );
    hostLobby.send("lobby.start", {});
    const [hostAssignment, guestAssignment] = await Promise.all([
      hostAssignmentPromise,
      guestAssignmentPromise,
    ]);
    assertAssignment(hostAssignment);
    assertAssignment(guestAssignment);
    if (hostAssignment.matchId !== guestAssignment.matchId
      || hostAssignment.reservation.roomId !== guestAssignment.reservation.roomId) {
      throw new Error("Adverse clients were not assigned to the same authoritative match.");
    }

    hostMatch = await hostClient.consumeSeatReservation(hostAssignment.reservation);
    guestMatch = await guestClient.consumeSeatReservation(guestAssignment.reservation);
    hostStream = createAdverseRecipientStream(hostMatch, hostAssignment);
    guestStream = createAdverseRecipientStream(guestMatch, guestAssignment);

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
      hostStream.beginTransportRecovery();
    });
    hostMatch.onReconnect(() => {
      reconnectCount += 1;
    });
    hostMatch.onLeave((code, reason) => {
      if (!cleaningUp) unexpectedLeave = new Error(`Host left during adverse recovery (${code}): ${reason ?? ""}`);
    });

    hostMatch.send("match.hello", VERSION_OFFER);
    guestMatch.send("match.hello", VERSION_OFFER);
    await waitFor(() => {
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.hello
        && guestStream.hello
        && hostStream.isConverged()
        && guestStream.isConverged();
    }, "initial protocol and reference/adverse convergence");
    if (hostStream.referenceView.participants.length !== 5
      || guestStream.referenceView.participants.length !== 5
      || hostStream.referenceView.participants.filter((participant) => participant.id.startsWith("ai-")).length !== 3
      || guestStream.referenceView.participants.filter((participant) => participant.id.startsWith("ai-")).length !== 3) {
      throw new Error("Adverse match did not preserve the two-human plus three-AI faction roster.");
    }
    await hostLobby.leave().catch(() => undefined);
    hostLobby = undefined;
    await guestLobby.leave().catch(() => undefined);
    guestLobby = undefined;

    hostStream.enableImpairment();
    guestStream.enableImpairment();
    await waitFor(() => {
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.droppedDeltaCount >= 1
        && guestStream.droppedDeltaCount >= 1
        && hostStream.observedImpairedDeltas >= IMPAIRMENT_SAMPLE_DELTAS
        && guestStream.observedImpairedDeltas >= IMPAIRMENT_SAMPLE_DELTAS
        && hostStream.reorderedDeliveryCount >= 1
        && guestStream.reorderedDeliveryCount >= 1
        && hostStream.gapDetectionCount >= 1
        && guestStream.gapDetectionCount >= 1;
    }, "deterministic loss, reordering and checksum-chain gap detection");

    hostStream.disableImpairment();
    guestStream.disableImpairment();
    const hostSnapshotsBeforeResync = hostStream.snapshotCount;
    const guestSnapshotsBeforeResync = guestStream.snapshotCount;
    hostMatch.send("match.syncRequest", VERSION_OFFER);
    guestMatch.send("match.syncRequest", VERSION_OFFER);
    await waitFor(() => {
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.snapshotCount > hostSnapshotsBeforeResync
        && guestStream.snapshotCount > guestSnapshotsBeforeResync
        && hostStream.isConverged()
        && guestStream.isConverged();
    }, "full snapshot convergence after adverse delivery");
    const hostAdverseResyncSnapshots = hostStream.snapshotCount - hostSnapshotsBeforeResync;
    const guestAdverseResyncSnapshots = guestStream.snapshotCount - guestSnapshotsBeforeResync;
    const tickBeforeDrop = hostStream.referenceView.serverTick;
    const guestTickBeforeDrop = guestStream.referenceView.serverTick;

    forceReconnectableSocketDrop(hostMatch);
    await waitFor(() => dropCount === 1, "real host socket drop");
    await waitFor(() => {
      guestStream.assertHealthy();
      return guestStream.referenceView?.serverTick >= guestTickBeforeDrop + 5;
    }, "guest authoritative stream continuing during host disconnect");
    await waitFor(() => {
      if (unexpectedLeave) throw unexpectedLeave;
      hostStream.assertHealthy();
      const lifecycleTypes = hostStream.lifecycle.map((entry) => entry.type);
      return reconnectCount === 1
        && hostStream.recoverySnapshotCount >= 1
        && lifecycleTypes.includes("recovering")
        && lifecycleTypes.includes("resumed")
        && hostStream.isConverged();
    }, "host reconnect lifecycle and snapshot convergence", 15_000);

    hostMatch.send("match.syncRequest", VERSION_OFFER);
    guestMatch.send("match.syncRequest", VERSION_OFFER);
    await waitFor(() => {
      if (unexpectedLeave) throw unexpectedLeave;
      hostStream.assertHealthy();
      guestStream.assertHealthy();
      return hostStream.isConverged()
        && guestStream.isConverged()
        && hostStream.referenceView.serverTick > tickBeforeDrop
        && guestStream.referenceView.serverTick > guestTickBeforeDrop;
    }, "final per-recipient tick and checksum convergence");

    const hostFinal = hostStream.referenceView;
    const guestFinal = guestStream.referenceView;
    if (!verifyVisibleSnapshotChecksum(hostFinal) || !verifyVisibleSnapshotChecksum(guestFinal)) {
      throw new Error("Final authoritative recipient checksum validation failed.");
    }
    if (hostFinal.checksum !== hostStream.adverseView.checksum
      || guestFinal.checksum !== guestStream.adverseView.checksum) {
      throw new Error("Final adverse reconstruction hash diverged from its recipient reference stream.");
    }

    const result = {
      result: "PASS",
      roomCode,
      matchId: hostAssignment.matchId,
      matchRoomId: hostMatch.roomId,
      players: 2,
      factions: 5,
      checks: {
        realColyseusClients: true,
        serverOwnedAiFactions: 3,
        deterministicReceiveLatencyMs: RECEIVE_LATENCY_MILLISECONDS,
        packetLossSample: {
          deltasPerRecipient: IMPAIRMENT_SAMPLE_DELTAS,
          droppedPerRecipient: 1,
          percent: 2,
        },
        droppedDeltas: {
          host: hostStream.droppedDeltaCount,
          guest: guestStream.droppedDeltaCount,
        },
        reorderedDeliveries: {
          host: hostStream.reorderedDeliveryCount,
          guest: guestStream.reorderedDeliveryCount,
        },
        deltaGapDetections: {
          host: hostStream.gapDetectionCount,
          guest: guestStream.gapDetectionCount,
        },
        fullSnapshotResync: {
          hostSnapshots: hostAdverseResyncSnapshots,
          guestSnapshots: guestAdverseResyncSnapshots,
        },
        realSocketDrops: dropCount,
        socketReconnects: reconnectCount,
        reconnectLifecycle: hostStream.lifecycle.map((entry) => entry.type),
        authorityTicksDuringDisconnect: guestStream.referenceView.serverTick - guestTickBeforeDrop,
        perRecipientFinalHashConsistency: {
          host: {
            tick: hostFinal.serverTick,
            reference: hostFinal.checksum,
            adverse: hostStream.adverseView.checksum,
          },
          guest: {
            tick: guestFinal.serverTick,
            reference: guestFinal.checksum,
            adverse: guestStream.adverseView.checksum,
          },
        },
      },
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    cleaningUp = true;
    hostStream?.dispose();
    guestStream?.dispose();
    await guestMatch?.leave().catch(() => undefined);
    await hostMatch?.leave().catch(() => undefined);
    await guestLobby?.leave().catch(() => undefined);
    await hostLobby?.leave().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runMultiplayerAdverseSmoke();
}
