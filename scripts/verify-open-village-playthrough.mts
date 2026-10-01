import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createVillageAssaultRuntime, VILLAGE_ASSAULT_VICTORY_POLICY } from "../apps/client/src/game/villageAssaultRuntime.ts";
import { createVictoryPresentation } from "../apps/client/src/game/victoryPresentation.ts";
import { hashMatchState, RULES_VERSION, VILLAGE_ASSAULT_CONTROL_OBJECTIVE } from "@village-siege/shared";

fs.mkdirSync(".audit-tmp", { recursive: true });
const started = performance.now();
const options = { playerVillageId: "pinehold", aiVillageId: "riverstead", aiPersonality: "balanced", aiDifficulty: "standard", seed: 220420, matchId: "r22-open-village-default-ai" } as const;
const runtime = createVillageAssaultRuntime(options);
assert.deepEqual(runtime.view.victory.policy, VILLAGE_ASSAULT_VICTORY_POLICY);
assert.equal(runtime.state.map.width, 32);
assert.equal(runtime.state.map.height, 24);
const report: any = { options, rulesVersion: RULES_VERSION, method: "Public runtime commands and fixed steps; all player choices use VisibleSnapshot. No canonical mutations, resource grants, AI control or victory override.", commands: [], eventCounts: {}, samples: {}, checkpoints: [], deposits: { food: 0, wood: 0, stone: 0 }, spawnedPlayerArmy: [], aiBuiltBarracks: false, aiProducedArmy: false };
const own = () => runtime.view.entities.filter(e => e.ownerId === runtime.playerId);
const army = () => own().filter(e => e.kind === "unit" && e.typeId !== "villager");
function events(items: readonly any[]) {
  for (const item of items) {
    report.eventCounts[item.type] = (report.eventCounts[item.type] ?? 0) + 1;
    if (["entityDamaged", "statusApplied", "matchFinished", "resourcesDeposited"].includes(item.type)) {
      const bucket = report.samples[item.type] ??= [];
      if (bucket.length < 20) bucket.push({ tick: runtime.view.serverTick, event: item });
    }
    if (item.type === "resourcesDeposited" && item.playerId === runtime.playerId) report.deposits[item.resourceKind] += item.amount;
    if (item.type === "entitySpawned" && item.entity.ownerId === runtime.playerId && item.entity.kind === "unit" && item.entity.typeId !== "villager") report.spawnedPlayerArmy.push(item.entity.id);
  }
}
function issue(value: any, label: string, required = true) {
  const before = structuredClone(runtime.view.wallet);
  const result = runtime.issuePlayerCommand(value);
  report.commands.push({ tick: runtime.view.serverTick, sequence: result.sequence, label, command: value, accepted: result.accepted, rejectCode: result.rejectCode, walletBefore: before, walletAfter: structuredClone(runtime.view.wallet) });
  events(result.events);
  if (required) assert.equal(result.accepted, true, `${label}: ${result.rejectCode}`);
  return result.accepted;
}
function step() {
  events(runtime.step(100).events);
  // Private authority is audited for these booleans only, never used to choose player orders.
  report.aiBuiltBarracks ||= runtime.state.entities.some(e => e.ownerId === runtime.aiPlayerId && e.kind === "building" && e.typeId === "barracks" && e.complete);
  report.aiProducedArmy ||= runtime.state.entities.some(e => e.ownerId === runtime.aiPlayerId && e.kind === "unit" && e.typeId !== "villager");
  if (runtime.view.serverTick % 500 === 0) console.log(JSON.stringify({ tick: runtime.view.serverTick, phase: runtime.view.phase, army: army().length, wallet: runtime.view.wallet, victory: runtime.view.victory.control, score: runtime.view.victory.teams.find(t => t.teamId === "team-player")?.timedControlScoreTicks }));
  assert.ok(performance.now() - started < 90000, "bounded ninety-second verification limit");
}
function until(check: () => boolean, limit: number, label: string) {
  const end = runtime.view.serverTick + limit;
  while (!check() && runtime.view.phase === "playing" && runtime.view.serverTick < end) step();
  assert.ok(check(), `${label} not reached by tick ${runtime.view.serverTick}`);
  report.checkpoints.push({ label, tick: runtime.view.serverTick, wallet: structuredClone(runtime.view.wallet) });
}

try {
  const workers = own().filter(e => e.kind === "unit" && e.typeId === "villager");
  for (const [index, type] of ["food", "wood", "stone"].entries()) {
    const source = runtime.view.entities.find(e => e.kind === "resource" && e.typeId === type && e.position.x < 16)!;
    issue({ type: "gather", entityIds: [workers[index].id], targetId: source.id }, `gather ${type}`);
  }
  until(() => Object.values(report.deposits).every(n => Number(n) > 0), 300, "real deposits for every resource");
  issue({ type: "build", builderIds: [workers[2].id], buildingType: "house", origin: { x: 6, y: 8 } }, "build first house");
  until(() => own().some(e => e.kind === "building" && e.typeId === "house" && e.complete), 350, "house completes through real construction");
  issue({ type: "build", builderIds: [workers[2].id], buildingType: "barracks", origin: { x: 7, y: 13 } }, "build first barracks");
  until(() => own().some(e => e.kind === "building" && e.typeId === "barracks" && e.complete), 400, "barracks completes through real construction");
  const barracks = own().find(e => e.kind === "building" && e.typeId === "barracks")!;
  const stone = runtime.view.entities.find(e => e.kind === "resource" && e.typeId === "stone" && e.position.x < 16)!;
  issue({ type: "gather", entityIds: [workers[2].id], targetId: stone.id }, "builder returns to economy");
  issue({ type: "setRallyPoint", producerId: barracks.id, target: { x: 12, y: 12 } }, "set open army staging point");
  issue({ type: "train", producerId: barracks.id, unitType: "shieldBearer", count: 1 }, "train shield bearer");
  issue({ type: "train", producerId: barracks.id, unitType: "warrior", count: 4 }, "train four warriors");
  until(() => report.spawnedPlayerArmy.length >= 5, 1000, "five trained units leave the open barracks");
  const shield = army().find(e => e.typeId === "shieldBearer");
  if (shield) issue({ type: "castAbility", casterId: shield.id, abilityId: "shieldWall", target: { kind: "self" } }, "activate player shield wall");
  until(() => report.samples.statusApplied?.some((entry: any) => entry.event.statusId === "shieldWall" && report.spawnedPlayerArmy.includes(entry.event.targetId)), 20, "player shield wall takes effect");
  const objective = VILLAGE_ASSAULT_CONTROL_OBJECTIVE.point;
  issue({ type: "move", entityIds: army().map(e => e.id), target: objective }, "occupy central objective");
  issue({ type: "setStance", entityIds: army().map(e => e.id), stance: "holdGround" }, "hold central objective");
  let lastEnemyTarget: string | null = null;
  let lastRetarget = -500;
  while (runtime.view.phase === "playing" && runtime.view.serverTick < 6000) {
    const tick = runtime.view.serverTick;
    if (tick % 30 === 0) {
      const units = army();
      const enemies = runtime.view.entities.filter(e => e.ownerId === runtime.aiPlayerId && (e.kind === "unit" || (e.kind === "building" && e.typeId === "defenseTower")) && Math.hypot(e.position.x - objective.x, e.position.y - objective.y) <= 6);
      const threat = enemies.sort((a, b) => Math.hypot(a.position.x - objective.x, a.position.y - objective.y) - Math.hypot(b.position.x - objective.x, b.position.y - objective.y))[0];
      if (units.length && threat && (threat.id !== lastEnemyTarget || tick - lastRetarget > 180)) {
        issue({ type: "attack", entityIds: units.map(e => e.id), targetId: threat.id }, "attack a visible threat to central control", false);
        lastEnemyTarget = threat.id; lastRetarget = tick;
      } else if (units.length && !threat && (lastEnemyTarget !== null || tick - lastRetarget > 240)) {
        issue({ type: "move", entityIds: units.map(e => e.id), target: objective }, "return live troops to central control", false);
        lastEnemyTarget = null; lastRetarget = tick;
      }
      const defender = units.find(e => e.typeId === "shieldBearer" && e.combatPhase === "ready" && (e.abilityReadyTick ?? 0) <= tick);
      if (defender && threat) issue({ type: "castAbility", casterId: defender.id, abilityId: "shieldWall", target: { kind: "self" } }, "shield wall against visible pressure", false);
      const production = own().find(e => e.id === barracks.id);
      if (production?.ownerControl && production.ownerControl.productionQueue.length < 2 && runtime.view.wallet.food >= 65 && runtime.view.wallet.wood >= 30 && runtime.view.population.used < runtime.view.population.capacity - 1) issue({ type: "train", producerId: barracks.id, unitType: "warrior", count: 1 }, "economy-funded reinforcement", false);
    }
    step();
  }
  assert.equal(runtime.view.phase, "finished", "natural match must finish within the playthrough bound");
  assert.ok(runtime.view.victory.winningTeamIds.includes("team-player"), "player wins using default policy");
  assert.ok(report.aiBuiltBarracks, "normal AI built its own barracks");
  assert.ok(report.aiProducedArmy, "normal AI actually trained military units");
  assert.ok((report.eventCounts.entityDamaged ?? 0) > 0, "real combat took place");
  const presentation = createVictoryPresentation(runtime.view.victory, "team-player", runtime.view.serverTick);
  assert.equal(presentation.outcome, "victory");
  const replay = runtime.exportReplayJson();
  fs.writeFileSync(".audit-tmp/r22-open-village-owner-private-replay.json", replay);
  fs.writeFileSync(".audit-tmp/r22-open-village-owner-private-journal.json", runtime.exportJournalJson());
  const restored = createVillageAssaultRuntime(options);
  restored.importReplayJson(replay);
  assert.equal(hashMatchState(restored.state), hashMatchState(runtime.state));
  const restart = createVillageAssaultRuntime({ ...options, seed: options.seed + 1, matchId: `${options.matchId}-restart` });
  assert.equal(restart.view.phase, "playing"); assert.equal(restart.view.serverTick, 0); assert.equal(restart.view.victory.outcome, null);
  report.result = { status: "VERIFIED", finalTick: runtime.view.serverTick, simulatedSeconds: runtime.view.serverTick / 10, victory: structuredClone(runtime.view.victory), presentation, replayHashMatches: true, restart: { phase: restart.view.phase, tick: restart.view.serverTick, outcome: restart.view.victory.outcome }, finalHash: hashMatchState(runtime.state) };
} catch (error) {
  process.exitCode = 1;
  report.result = { status: "LIMITATION", tick: runtime.view.serverTick, error: error instanceof Error ? error.message : String(error), victory: structuredClone(runtime.view.victory), livingArmy: army().map(e => ({ id: e.id, type: e.typeId, pos: e.position, hp: e.hitPoints })) };
} finally {
  report.wallMilliseconds = Math.round(performance.now() - started);
  fs.mkdirSync("docs/evidence/r22", { recursive: true });
  fs.writeFileSync("docs/evidence/r22/open-village-playthrough.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, accepted: report.commands.filter((c: any) => c.accepted).length, rejected: report.commands.filter((c: any) => !c.accepted).length, deposits: report.deposits, born: report.spawnedPlayerArmy.length, aiBuiltBarracks: report.aiBuiltBarracks, aiProducedArmy: report.aiProducedArmy, events: report.eventCounts, wallMilliseconds: report.wallMilliseconds }, null, 2));
}

