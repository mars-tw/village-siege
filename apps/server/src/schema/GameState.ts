import { MapSchema, Schema, type } from "@colyseus/schema";

export type MatchPhase = "lobby" | "playing" | "finished";

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "Player";
  @type("string") villageId = "pinehold";
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") host = false;
  @type("uint32") lastSequence = 0;
}

export class GameState extends Schema {
  @type("string") roomCode = "";
  @type("string") phase: MatchPhase = "lobby";
  @type("uint32") seed = 0;
  @type("uint32") serverTick = 0;
  @type("string") winnerId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
