import { describe, expect, it } from "vitest";
import { GAMEPLAY_FILM_CLIPS, resolveGameplayFilmClip } from "../src/ui/gameplayFilmGalleryMetadata";

describe("gameplay film gallery metadata", () => {
  it("keeps the three real-recording chapters and deploy-safe media paths", () => {
    expect(GAMEPLAY_FILM_CLIPS.map(clip => [clip.title, clip.videoPath, clip.posterPath])).toEqual([
      ["採集與建造", "media/gameplay/economy.mp4", "media/gameplay/economy.webp"],
      ["科技與部隊移動", "media/gameplay/movement.mp4", "media/gameplay/movement.webp"],
      ["林緣遭遇戰", "media/gameplay/battle.mp4", "media/gameplay/battle.webp"],
    ]);
    expect(GAMEPLAY_FILM_CLIPS.every(clip => clip.audioLabel === "無音訊")).toBe(true);
    expect(GAMEPLAY_FILM_CLIPS.every(clip => clip.audioLabel === "無音訊")).toBe(true);
  });

  it("resolves media under the configured deployment base", () => {
    expect(resolveGameplayFilmClip(GAMEPLAY_FILM_CLIPS[0], "/village-siege")).toEqual({
      videoUrl: "/village-siege/media/gameplay/economy.mp4",
      posterUrl: "/village-siege/media/gameplay/economy.webp",
    });
  });
});
