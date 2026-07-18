import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Client } from "@colyseus/sdk";

const SERVER_URL = process.env.COLYSEUS_URL ?? "http://localhost:2567";
const ROOM_NAME = "village_siege";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(100);
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

async function expectRejectedCommand(room, expectedCode, send) {
  let timeout;
  let removeListener = () => undefined;
  try {
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        removeListener = room.onMessage("match.commandResult", (payload) => {
          if (payload?.accepted === false && payload.code === expectedCode) {
            resolve(payload);
          } else {
            reject(new Error(
              `Expected rejection ${expectedCode}, received ${JSON.stringify(payload)}.`,
            ));
          }
        });
        send();
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for rejection ${expectedCode}.`)),
          8_000,
        );
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timeout);
    removeListener();
  }
}

function createRoomCode() {
  return [...randomBytes(6)].map((byte) => ALPHABET[byte & 31]).join("");
}

export async function runMultiplayerSmoke() {
  const hostClient = new Client(SERVER_URL);
  const guestClient = new Client(SERVER_URL);
  let hostRoom;
  let guestRoom;

  try {
  const roomCode = createRoomCode();
  hostRoom = await hostClient.create(ROOM_NAME, {
    roomCode,
    playerName: "Host smoke test",
    villageId: "pinehold",
  });
  guestRoom = await guestClient.join(ROOM_NAME, {
    roomCode,
    playerName: "Guest smoke test",
    villageId: "riverstead",
  });

  await waitFor(() => hostRoom.state.players.size === 2, "two-player roster");

  const nonHostRejection = await expectRejectedCommand(
    guestRoom,
    "HOST_ONLY",
    () => guestRoom.send("lobby.start", {}),
  );
  const notReadyRejection = await expectRejectedCommand(
    hostRoom,
    "PLAYERS_NOT_READY",
    () => hostRoom.send("lobby.start", {}),
  );
  const invalidPayloadRejection = await expectRejectedCommand(
    guestRoom,
    "INVALID_PAYLOAD",
    () => guestRoom.send("lobby.ready", { ready: "yes" }),
  );

  guestRoom.reconnection.minUptime = 0;
  const dropped = waitForSignal(
    (resolve) => guestRoom.onDrop.once(resolve),
    "guest connection drop",
  );
  const reconnected = waitForSignal(
    (resolve) => guestRoom.onReconnect.once(resolve),
    "guest automatic reconnection",
  );
  guestRoom.connection.close(4010, "multiplayer smoke reconnection");
  await dropped;
  await reconnected;
  await waitFor(
    () => hostRoom.state.players.get(guestRoom.sessionId)?.connected === true,
    "reconnected guest in authoritative roster",
  );

  hostRoom.onMessage("match.started", () => undefined);
  guestRoom.onMessage("match.started", () => undefined);
  hostRoom.send("lobby.ready", { ready: true });
  guestRoom.send("lobby.ready", { ready: true });
  await waitFor(
    () => [...hostRoom.state.players.values()].every((player) => player.ready),
    "both players ready",
  );

  hostRoom.send("lobby.start", {});
  await waitFor(
    () => (
      hostRoom.state.phase === "playing"
      && guestRoom.state.phase === "playing"
      && hostRoom.state.serverTick >= 2
      && guestRoom.state.serverTick >= 2
    ),
    "authoritative match ticks",
  );

  if (hostRoom.roomId !== guestRoom.roomId) {
    throw new Error("Clients joined different room IDs.");
  }

  const result = {
    result: "PASS",
    roomCode: hostRoom.state.roomCode,
    roomId: hostRoom.roomId,
    players: hostRoom.state.players.size,
    phase: hostRoom.state.phase,
    serverTick: hostRoom.state.serverTick,
    seed: hostRoom.state.seed,
    checks: {
      twoPlayerRoom: true,
      nonHostStartRejected: nonHostRejection.code,
      unreadyStartRejected: notReadyRejection.code,
      invalidPayloadRejected: invalidPayloadRejection.code,
      guestReconnected: true,
      authoritativeTick: true,
    },
  };
  console.log(JSON.stringify(result));
  return result;
  } finally {
    await guestRoom?.leave().catch(() => undefined);
    await hostRoom?.leave().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  await runMultiplayerSmoke();
}
