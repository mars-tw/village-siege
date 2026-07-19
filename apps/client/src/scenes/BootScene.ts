import Phaser from "phaser";
import { assertCombatAnimationManifestValid } from "../game/combatAnimationManifest";

export class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }

  preload(): void {
    // Keep first paint light. Combat sheets are loaded only after the player
    // starts a battle instead of blocking the village selector.
    assertCombatAnimationManifestValid();
  }

  create(): void {
    this.registry.set("resources", { food: 420, wood: 360, stone: 240 });
    this.cameras.main.fadeIn(300, 8, 16, 15);
    this.scene.start("VillageSelectScene");
  }
}

export default BootScene;
