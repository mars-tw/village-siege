import { describe, expect, it, vi } from "vitest";

// Frame rendering needs texture/display interfaces, not a WebGL browser in unit tests.
vi.mock("phaser", () => ({ default: {} }));

import { DEFAULT_TEAM_PALETTES } from "../src/game/combatArt";
import { frameAssetFiles } from "../src/game/combatAnimationManifest";
import { FACING_ORDER } from "../src/game/directionalAnimation";
import { VillageWorkerActor } from "../src/game/villageWorkerActor";
import { VILLAGE_WORKER_ANIMATION_MANIFEST, VILLAGE_WORKER_FRAME_ASSET } from "../src/game/villageWorkerAnimation";

class DisplayNode {
  x = 0; y = 0; depth = 0; width = 0; height = 0;
  scaleX = 1; scaleY = 1; originX = 0; originY = 0; flipX = false;
  textureKey = ""; frameName = ""; destroyed = false;
  children: DisplayNode[] = [];
  fills: number[] = [];
  setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }
  setDepth(value: number) { this.depth = value; return this; }
  setSize(w: number, h: number) { this.width = w; this.height = h; return this; }
  setScale(x: number, y = x) { this.scaleX = x; this.scaleY = y; return this; }
  setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; }
  setTexture(texture: string, frame: string) { this.textureKey = texture; this.frameName = frame; return this; }
  setFlipX(value: boolean) { this.flipX = value; return this; }
  setFillStyle(color: number) { this.fills.push(color); return this; }
  add(child: DisplayNode) { this.children.push(child); return this; }
  clear() { this.fills = []; return this; }
  lineStyle() { return this; }
  lineBetween() { return this; }
  fillStyle(color: number) { this.fills.push(color); return this; }
  fillTriangle() { return this; }
  destroy() { this.destroyed = true; }
}

function sceneFixture() {
  const images: DisplayNode[] = [];
  const graphics: DisplayNode[] = [];
  const textures = new Map(FACING_ORDER.map(facing => {
    const frames = new Map<string, { sourceIndex: number; cutX: number; cutY: number; cutWidth: number; cutHeight: number }>();
    return [VILLAGE_WORKER_ANIMATION_MANIFEST.directionalTextureKeys![facing], {
      source: [{ width: 384, height: 672 }],
      frames,
      has: (name: string) => frames.has(name),
      get: (name: string) => frames.get(name),
      add: (name: string, sourceIndex: number, cutX: number, cutY: number, cutWidth: number, cutHeight: number) => {
        const frame = { sourceIndex, cutX, cutY, cutWidth, cutHeight };
        frames.set(name, frame);
        return frame;
      },
    }];
  }));
  const scene = {
    textures: { exists: (key: string) => textures.has(key), get: (key: string) => textures.get(key) },
    add: {
      ellipse: () => new DisplayNode(),
      graphics: () => { const node = new DisplayNode(); graphics.push(node); return node; },
      image: (_x: number, _y: number, key: string, frame: string) => {
        const node = new DisplayNode().setTexture(key, frame); images.push(node); return node;
      },
      container: (x: number, y: number, children: DisplayNode[]) => {
        const node = new DisplayNode().setPosition(x, y); node.children.push(...children); return node;
      },
    },
  };
  return { scene, images, graphics, textures };
}

describe("dedicated worker frame renderer", () => {
  it("addresses six native civilian sheets with six distinct four-frame action rows", () => {
    const files = frameAssetFiles(VILLAGE_WORKER_FRAME_ASSET);
    expect(files).toHaveLength(6);
    expect(files.map(file => file.path.split("/").at(-1))).toEqual(FACING_ORDER.map(f => `${f}.png`));
    expect(new Set(files.map(file => file.textureKey)).size).toBe(6);
    expect(files.every(file => file.path.includes("/frontier/characters/villager/facings/"))).toBe(true);
    expect(VILLAGE_WORKER_ANIMATION_MANIFEST).toMatchObject({ id: "villager", frameWidth: 96, frameHeight: 112, anchorX: 48, anchorY: 88, artScale: 1 });
    expect(Object.entries(VILLAGE_WORKER_ANIMATION_MANIFEST.actions).map(([action, row]) => [action, row.row, row.frames]))
      .toEqual([["idle", 0, 4], ["walk", 1, 4], ["attack", 2, 4], ["hurt", 3, 4], ["death", 4, 4], ["cast", 5, 4]]);
  });

  it("advances real walking source frames without bobbing or moving the actor bitmap", () => {
    const fixture = sceneFixture();
    const actor = new VillageWorkerActor(fixture.scene as never, { x: 110, y: 220, action: "walk" });
    const image = fixture.images[0]!;
    const before = image.frameName;
    actor.update(126);
    expect(actor.snapshot.frame).toBe(1);
    expect(image.frameName).not.toBe(before);
    const frame = fixture.textures.get(image.textureKey)!.frames.get(image.frameName)!;
    expect(frame).toMatchObject({ cutX: 96, cutY: 112, cutWidth: 96, cutHeight: 112 });
    expect([actor.container.x, actor.container.y, image.x, image.y]).toEqual([110, 220, 0, 0]);
  });

  it("keeps work frames advancing through repeated online action snapshots", () => {
    const fixture = sceneFixture();
    const actor = new VillageWorkerActor(fixture.scene as never, { x: 0, y: 0 });
    actor.setWorkerPose("harvestWood").play("attack", true).update(126);
    actor.play("attack", true).update(126);
    expect(actor.snapshot).toMatchObject({ id: "villager", action: "attack", frame: 2, workerPose: "harvestWood" });
    actor.play("attack", true).update(252);
    expect(actor.snapshot.action).toBe("attack");
    expect(actor.snapshot.finished).toBe(false);
    const frame = fixture.textures.get(fixture.images[0]!.textureKey)!.frames.get(fixture.images[0]!.frameName)!;
    expect(frame.cutY).toBe(224);
  });

  it("uses actual craft, hurt and final death rows, preserving death's final pose", () => {
    const fixture = sceneFixture();
    const actor = new VillageWorkerActor(fixture.scene as never, { x: 0, y: 0 });
    actor.setWorkerPose("construction").play("cast", true).update(126);
    expect(actor.snapshot).toMatchObject({ action: "cast", frame: 1 });
    const image = fixture.images[0]!;
    expect(fixture.textures.get(image.textureKey)!.frames.get(image.frameName)!.cutY).toBe(560);
    actor.play("hurt", true).update(120);
    expect(actor.snapshot).toMatchObject({ action: "hurt", frame: 1 });
    actor.play("death", true).update(1000);
    const final = image.frameName;
    expect(actor.snapshot).toMatchObject({ action: "death", frame: 3, finished: true });
    actor.update(1000);
    expect(image.frameName).toBe(final);
  });

  it("selects independent rear/left textures without mirroring or tinting the worker", () => {
    const fixture = sceneFixture();
    const actor = new VillageWorkerActor(fixture.scene as never, { x: 0, y: 0 });
    for (const facing of FACING_ORDER) {
      actor.setFacing(facing);
      expect(fixture.images[0]!.textureKey).toBe(VILLAGE_WORKER_ANIMATION_MANIFEST.directionalTextureKeys![facing]);
      expect(fixture.images[0]!.flipX).toBe(false);
    }
    actor.setTeamPalette(DEFAULT_TEAM_PALETTES.enemy);
    expect(fixture.graphics[0]!.fills).toContain(DEFAULT_TEAM_PALETTES.enemy.primary);
  });

  it("rejects missing worker directions rather than reusing warrior or a static pose", () => {
    const fixture = sceneFixture();
    fixture.textures.delete(VILLAGE_WORKER_ANIMATION_MANIFEST.directionalTextureKeys!.nw);
    expect(() => new VillageWorkerActor(fixture.scene as never, { x: 0, y: 0 })).toThrow("Required frame-animation texture is missing");
  });
});
