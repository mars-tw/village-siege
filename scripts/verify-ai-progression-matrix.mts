import assert from "node:assert/strict";
import fs from "node:fs";
import { createVillageAssaultRuntime, VILLAGE_ASSAULT_VICTORY_POLICY } from "../apps/client/src/game/villageAssaultRuntime.ts";
import { RULES_VERSION, type AiDifficulty, type AiPersonality } from "@village-siege/shared";

// Bounded macro-behavior gate. The human makes the same three visible economy
// orders and keeps the starting settlement; normal AI runs every fixed tick.
// Authority is inspected only to report the opponent's actions after stepping.
const report: any = { rulesVersion: RULES_VERSION, method: "15 fresh public runtimes, all five AI personalities at novice/standard/veteran. Unchanged starting economy, AI and default victory policy. Human orders three visible gather loops only; canonical state is read solely for opponent audit facts.", scenarios: [] };
const expected = { aggressor: "warrior", guardian: "shieldBearer", prosperer: "archer", balanced: "shieldBearer", raider: "boarRider" } as const;
for (const personality of ["aggressor", "guardian", "prosperer", "balanced", "raider"] as AiPersonality[]) {
  for (const difficulty of ["novice", "standard", "veteran"] as AiDifficulty[]) {
    const options = { playerVillageId: "pinehold", aiVillageId: "riverstead", aiPersonality: personality, aiDifficulty: difficulty, seed: 230501, matchId: `ai-matrix-${personality}-${difficulty}` } as const;
    const runtime = createVillageAssaultRuntime(options);
    assert.deepEqual(runtime.view.victory.policy, VILLAGE_ASSAULT_VICTORY_POLICY);
    const workers = runtime.view.entities.filter(e => e.ownerId === runtime.playerId && e.kind === "unit" && e.typeId === "villager");
    for (const [index, kind] of ["food", "wood", "stone"].entries()) {
      const source = runtime.view.entities.find(e => e.kind === "resource" && e.typeId === kind && e.position.x < 16)!;
      assert.ok(runtime.issuePlayerCommand({ type: "gather", entityIds: [workers[index]!.id], targetId: source.id }).accepted);
    }
    let producedPreferredUnit = false;
    let advancedAtTick: number | null = null;
    while (runtime.view.phase === "playing" && runtime.view.serverTick < 6000) {
      runtime.step(100);
      const ai = runtime.state.players.find(p => p.id === runtime.aiPlayerId)!;
      producedPreferredUnit ||= runtime.state.entities.some(e => e.ownerId === ai.id && e.kind === "unit" && e.typeId === expected[personality]);
      if (advancedAtTick === null && ai.settlementTier !== "frontier") advancedAtTick = runtime.view.serverTick;
      if (producedPreferredUnit && advancedAtTick !== null) break;
    }
    const journal = JSON.parse(runtime.exportJournalJson());
    const aiCommands = journal.operations.filter((op: any) => op.kind === "accepted-command" && op.source === "ai");
    const gatherOrders = aiCommands.filter((op: any) => op.envelope.command.type === "gather").length;
    const ai = runtime.state.players.find(p => p.id === runtime.aiPlayerId)!;
    const authority = runtime.state.aiControllers.find(a => a.playerId === ai.id)!;
    const aiWon = runtime.view.phase === "finished" && runtime.view.victory.winningTeamIds.includes("team-ai");
    const result = { personality, difficulty, tick: runtime.view.serverTick, advancedAtTick, producedPreferredUnit, gatherOrders, acceptedAiCommands: aiCommands.length, buildings: runtime.state.entities.filter(e => e.ownerId === ai.id && e.kind === "building").map(e => ({ type: e.typeId, complete: e.kind === "building" && e.complete })), wallet: ai.resources, telemetry: authority.telemetry, finishReason: runtime.view.victory.finishReason, aiWon };
    report.scenarios.push(result);
    assert.ok(advancedAtTick !== null || aiWon, `${personality}/${difficulty}: no advancement or natural victory within ten minutes`);
    assert.ok(producedPreferredUnit, `${personality}/${difficulty}: no preferred military production`);
    assert.ok(aiCommands.length > 0 && gatherOrders > 0, `${personality}/${difficulty}: no accepted macro/economy commands`);
    console.log(JSON.stringify(result));
    fs.mkdirSync("docs/evidence/r24", { recursive: true });
    fs.writeFileSync("docs/evidence/r24/ai-progression-matrix.json", JSON.stringify(report, null, 2));
  }
}
report.status = "VERIFIED";
fs.writeFileSync("docs/evidence/r24/ai-progression-matrix.json", JSON.stringify(report, null, 2));
