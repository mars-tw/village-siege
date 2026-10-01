import type Phaser from "phaser";
import { publicAssetUrl } from "./publicAssetUrl";

export const COMMAND_ICON_TEXTURE = "frontier-command-icons";
export const COMMAND_ICON_PATH = publicAssetUrl("assets/original/frontier/command-icons.png");
export const COMMAND_ICON_ORDER = ["food", "wood", "stone", "build", "warrior", "shield", "archer", "mage", "musket", "boar", "siege", "era", "research", "attack", "move", "rally"] as const;
export type CommandIcon = typeof COMMAND_ICON_ORDER[number];

export function registerCommandIcons(scene: Phaser.Scene): boolean {
  if (!scene.textures.exists(COMMAND_ICON_TEXTURE)) return false;
  const texture = scene.textures.get(COMMAND_ICON_TEXTURE);
  const source = texture.getSourceImage() as HTMLImageElement;
  COMMAND_ICON_ORDER.forEach((name, index) => {
    if (!texture.has(name)) texture.add(name, 0, index % 4 * source.width / 4, Math.floor(index / 4) * source.height / 4, source.width / 4, source.height / 4);
  });
  return true;
}

export function commandIcon(glyph: string, label: string): CommandIcon | null {
  if (/採糧|卸糧/.test(label)) return "food";
  if (/伐木|卸木/.test(label)) return "wood";
  if (/採石|卸石/.test(label)) return "stone";
  if (/集結/.test(label)) return "rally";
  if (/升級|城寨期|工藝期/.test(label) && !/需/.test(label)) return "era";
  if (glyph === "研" || /科技|研究/.test(label)) return "research";
  if (/攻擊移動/.test(label)) return "attack";
  if (/巡邏|移動|軍隊/.test(label)) return "move";
  if (/重弩/.test(label)) return "siege";
  if (/野豬|斥候/.test(label)) return "boar";
  if (/火銃|火槍/.test(label)) return "musket";
  if (/法師|法印/.test(label)) return "mage";
  if (/弓手|弓箭|箭雨/.test(label)) return "archer";
  if (/槍衛|盾牌|盾牆/.test(label)) return "shield";
  if (/戰士|破甲/.test(label)) return "warrior";
  if (/建造|续建|續建|修復|工匠/.test(label) || glyph === "建" || glyph === "兵") return "build";
  return null;
}
