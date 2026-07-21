import { MapSchema, Schema, type } from "@colyseus/schema";

export type LobbyPhase = "lobby" | "starting";
export type PublicMatchPhase = "loading" | "playing" | "finished";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "Player";
  @type("string") villageId = "pinehold";
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") host = false;
}

export class LobbyState extends Schema {
  @type("string") roomCode = "";
  @type("string") phase: LobbyPhase = "lobby";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

export class MatchRoomState extends Schema {
  @type("string") matchId = "";
  @type("string") phase: PublicMatchPhase = "loading";
  @type("uint32") serverTick = 0;
}

/** @deprecated Use LobbyState. Kept as a source-compatible alias for extensions. */
export class GameState extends LobbyState {}
