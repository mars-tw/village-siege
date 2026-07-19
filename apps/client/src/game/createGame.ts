import Phaser from "phaser";
import { BootScene } from "../scenes/BootScene";
import { MultiplayerLobbyScene } from "../scenes/MultiplayerLobbyScene";
import { VillageSelectScene } from "../scenes/VillageSelectScene";
import { CombatShowcaseScene } from "../scenes/CombatShowcaseScene";
import { VillageAssaultScene } from "../scenes/VillageAssaultScene";

export function createGame(parent: string | HTMLElement): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1280,
    height: 720,
    backgroundColor: "#101917",
    render: { antialias: true, roundPixels: true },
    scale: {
      mode: Phaser.Scale.EXPAND,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      fullscreenTarget: typeof parent === "string" ? parent : parent.id || null,
      autoRound: true,
    },
    scene: [BootScene, VillageSelectScene, MultiplayerLobbyScene, VillageAssaultScene, CombatShowcaseScene]
  });
  return game;
}
