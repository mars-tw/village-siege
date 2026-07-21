import { describe, expect, it, vi } from "vitest";
import type { Client } from "@colyseus/core";
import { MATCH_PROTOCOL_VERSION, RULES_VERSION } from "@village-siege/shared";
import { MatchRoom } from "../src/rooms/MatchRoom.js";

describe("MatchRoom negotiation gate", () => {
  it("does not queue commands from an early-negotiated player before the full roster starts", () => {
    const room = new MatchRoom();
    const send = vi.fn();
    const client = { sessionId: "session-1", send } as unknown as Client;
    const internals = room as unknown as {
      playerIdBySession: Map<string, string>;
      negotiatedPlayerIds: Set<string>;
      handleCommand(client: Client, payload: unknown): void;
    };
    internals.playerIdBySession.set(client.sessionId, "player-1");
    internals.negotiatedPlayerIds.add("player-1");

    internals.handleCommand(client, {
      protocolVersion: MATCH_PROTOCOL_VERSION,
      rulesVersion: RULES_VERSION,
      commandId: "prestart_command_01",
      clientCommandSeq: 0,
      lastServerTickSeen: 0,
      command: { type: "surrender" },
    });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("match.commandResult", {
      commandId: "prestart_command_01",
      clientCommandSeq: 0,
      accepted: false,
      code: "MATCH_NOT_PLAYING",
      serverTick: 0,
    });
  });
});
