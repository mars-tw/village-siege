import Phaser from "phaser";
import { ANIMATED_MONSTER_FRAME_ASSETS, ANIMATED_UNIT_FRAME_ASSETS, assertCombatAnimationManifestValid } from "../game/combatAnimationManifest";

export class BootScene extends Phaser.Scene {
  private illustratedArtFailures: string[] = [];

  constructor() { super("BootScene"); }

  preload(): void {
    this.illustratedArtFailures = [];
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onArtLoadError, this);
    const illustratedUnits = [
      "warrior",
      "shieldBearer",
      "archer",
      "mage",
      "musketeer",
      "boarRider",
      "heavyCrossbowman",
    ] as const;
    for (const unitId of illustratedUnits) {
      this.load.image(`unit-art-${unitId}`, `/assets/original/units/${unitId}/portrait.png`);
    }
    assertCombatAnimationManifestValid();
    for (const asset of ANIMATED_UNIT_FRAME_ASSETS) {
      this.load.image(asset.textureKey, asset.path);
    }
    for (const asset of ANIMATED_MONSTER_FRAME_ASSETS) {
      this.load.image(asset.textureKey, asset.path);
    }
    const illustratedMonsters = ["miremaw", "ashwing", "rootback"] as const;
    for (const monsterId of illustratedMonsters) {
      this.load.image(`monster-art-${monsterId}`, `/assets/original/monsters/${monsterId}/portrait.png`);
    }
  }

  create(): void {
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onArtLoadError, this);
    if (this.illustratedArtFailures.length > 0) {
      this.cameras.main.setBackgroundColor("#171c1a");
      this.add.text(640, 310, "角色美術載入失敗", {
        color: "#ffb09c",
        fontFamily: "Segoe UI, Noto Sans TC, sans-serif",
        fontSize: "34px",
        fontStyle: "bold",
      }).setOrigin(0.5);
      this.add.text(640, 370, `缺少：${this.illustratedArtFailures.join("、")}\n請修復角色 PNG 後重新整理。`, {
        align: "center",
        color: "#f0ebcf",
        fontFamily: "Consolas, Noto Sans TC, monospace",
        fontSize: "18px",
      }).setOrigin(0.5);
      return;
    }
    this.registry.set("resources", { food: 420, wood: 360, stone: 240 });
    this.cameras.main.fadeIn(300, 8, 16, 15);
    this.scene.start("VillageSelectScene");
  }

  private onArtLoadError(file: { readonly key?: unknown }): void {
    const key = typeof file.key === "string" ? file.key : "unknown-unit-art";
    if ((key.startsWith("unit-art-") || key.startsWith("unit-action-sheet-") || key.startsWith("monster-art-") || key.startsWith("monster-action-sheet-")) && !this.illustratedArtFailures.includes(key)) {
      this.illustratedArtFailures.push(key);
    }
  }
}
