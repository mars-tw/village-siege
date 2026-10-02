import { publicAssetUrl } from "../game/publicAssetUrl";

export interface GameplayFilmClip {
  readonly id: "economy" | "movement" | "battle";
  readonly title: string;
  readonly description: string;
  readonly audioLabel: "無音訊";
  readonly videoPath: string;
  readonly posterPath: string;
}

export const GAMEPLAY_FILM_CLIPS: readonly GameplayFilmClip[] = Object.freeze([
  {
    id: "economy",
    title: "採集與建造",
    description: "兩段正常新局操作剪輯：工匠採集，以及選擇兵營、放置合法地基並施工。",
    audioLabel: "無音訊",
    videoPath: "media/gameplay/economy.mp4",
    posterPath: "media/gameplay/economy.webp",
  },
  {
    id: "movement",
    title: "科技與部隊移動",
    description: "接續自己正常遊玩的存檔，查看軍備科技，關閉後選取兩名戰士並下達移動命令。",
    audioLabel: "無音訊",
    videoPath: "media/gameplay/movement.mp4",
    posterPath: "media/gameplay/movement.webp",
  },
  {
    id: "battle",
    title: "林緣遭遇戰",
    description: "接續自己正常遊玩的存檔，派戰士攻擊移動，接近可見野獸，觀察近身交戰與戰利品結果。",
    audioLabel: "無音訊",
    videoPath: "media/gameplay/battle.mp4",
    posterPath: "media/gameplay/battle.webp",
  },
]);

export function resolveGameplayFilmClip(clip: GameplayFilmClip, baseUrl?: string): Readonly<{ videoUrl: string; posterUrl: string }> {
  return {
    videoUrl: publicAssetUrl(clip.videoPath, baseUrl),
    posterUrl: publicAssetUrl(clip.posterPath, baseUrl),
  };
}
