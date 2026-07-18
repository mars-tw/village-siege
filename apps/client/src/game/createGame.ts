import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { MatchScene } from "../scenes/MatchScene";
import { MultiplayerLobbyScene } from "../scenes/MultiplayerLobbyScene";
import { VillageSelectScene } from "../scenes/VillageSelectScene";
import { CombatShowcaseScene } from "../scenes/CombatShowcaseScene";
import { createHud } from "../ui/hud";

export function createGame(parent: string | HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1280,
    height: 720,
    backgroundColor: "#101917",
    render: { antialias: true, roundPixels: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, VillageSelectScene, MultiplayerLobbyScene, MatchScene, CombatShowcaseScene]
  });

  game.registry.set("createHud", createHud);
  return game;
}
