import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createVillageAssaultRuntime, VILLAGE_ASSAULT_VICTORY_POLICY } from "../apps/client/src/game/villageAssaultRuntime.ts";
import { BUILDINGS, COMBAT_UNIT_IDS, COMBAT_UNITS, getBuildingFootprint, hashMatchState, isVillageAssaultBuildableCell, RULES_VERSION, SETTLEMENT_TIERS, TECHNOLOGIES, TECHNOLOGY_ORDER, UNITS, type BuildingType, type GameCommand, type PublicEntityState, type ResourceKind, type ResourceWallet } from "@village-siege/shared";

// Run from the repository root:
// node --conditions=development --import tsx scripts/verify-full-progression.mts
// The canonical state is read only for final audit facts and state hashes. All
// player decisions are made from the recipient-filtered runtime.view.
const started = performance.now();
const options = { playerVillageId: "pinehold", aiVillageId: "riverstead", aiPersonality: "balanced", aiDifficulty: "standard", seed: 230501, matchId: "full-progression-standard-ai" } as const;
const runtime = createVillageAssaultRuntime(options);
const report: any = { options, rulesVersion: RULES_VERSION, method: "Public player commands and fixed steps under unmodified default victory policy and standard AI. VisibleSnapshot-only player decisions; no resource grants, canonical mutation or AI controls.", commands: [], checkpoints: [], snapshots: [], eventCounts: {}, deposits: { food: 0, wood: 0, stone: 0 }, expenditure: { food: 0, wood: 0, stone: 0 }, trainedTypes: [], technologies: [], combatSamples: [], aiAudit: {} };
const assignments = new Map<string, ResourceKind>();
let buildingWorker: string | null = null;
let buildingTarget: string | null = null;
let lastCombatOrder = -300;
let lastCombatTarget: string | null = null;
let armyDesired = { warrior: 2, shieldBearer: 2, archer: 6, boarRider: 1, mage: 1, musketeer: 1, heavyCrossbowman: 1 };
const own = () => runtime.view.entities.filter(e => e.ownerId === runtime.playerId);
const workers = () => own().filter(e => e.kind === "unit" && e.typeId === "villager");
const army = () => own().filter(e => e.kind === "unit" && e.typeId !== "villager");
const producer = (type: BuildingType) => own().find(e => e.kind === "building" && e.typeId === type && e.complete);
const affordable = (cost: ResourceWallet) => (Object.keys(cost) as ResourceKind[]).every(k => runtime.view.wallet[k] >= cost[k]);
function collect(events: readonly any[]) {
  for (const event of events) {
    report.eventCounts[event.type] = (report.eventCounts[event.type] ?? 0) + 1;
    if (event.type === "resourcesDeposited" && event.playerId === runtime.playerId) report.deposits[event.resourceKind] += event.amount;
    if (event.type === "entitySpawned" && event.entity.ownerId === runtime.playerId && event.entity.kind === "unit" && event.entity.typeId !== "villager" && !report.trainedTypes.includes(event.entity.typeId)) report.trainedTypes.push(event.entity.typeId);
    if (event.type === "technologyResearched" && event.playerId === runtime.playerId) report.technologies.push({ technologyId: event.technologyId, tick: runtime.view.serverTick });
    if (event.type === "entityDamaged" && report.combatSamples.length < 24) report.combatSamples.push({ tick: runtime.view.serverTick, event });
  }
}
function issue(command: GameCommand, label: string, required = true) {
  const before = { ...runtime.view.wallet };
  const result = runtime.issuePlayerCommand(command);
  report.commands.push({ tick: runtime.view.serverTick, sequence: result.sequence, label, command, accepted: result.accepted, rejectCode: result.rejectCode, walletBefore: before, walletAfter: { ...runtime.view.wallet } });
  if (result.accepted) for (const k of ["food", "wood", "stone"] as const) report.expenditure[k] += Math.max(0, before[k] - runtime.view.wallet[k]);
  collect(result.events);
  if (required) assert.equal(result.accepted, true, `${label}: ${result.rejectCode}`);
  return result.accepted;
}
function checkpoint(label: string) {
  report.checkpoints.push({ label, tick: runtime.view.serverTick, simulatedSeconds: runtime.view.serverTick / 10, wallet: { ...runtime.view.wallet }, population: { ...runtime.view.population }, tier: runtime.view.settlementTier, completedTechnologyIds: [...runtime.view.completedTechnologyIds] });
}
function assignEconomy() {
  const current = workers();
  for (const [index, worker] of current.entries()) {
    if (worker.id === buildingWorker) continue;
    const kind: ResourceKind = [0, 3, 6].includes(index) ? "food" : [1, 4, 5].includes(index) ? "wood" : "stone";
    const resource = runtime.view.entities.find(e => e.kind === "resource" && e.typeId === kind && e.position.x < 16);
    if (resource && (assignments.get(worker.id) !== kind || worker.civilianActivity === "idle")) {
      if (issue({ type: "gather", entityIds: [worker.id], targetId: resource.id }, `assign ${kind} worker`, false)) assignments.set(worker.id, kind);
    }
  }
}
function fight() {
  const units = army();
  if (!units.length) return;
  const threat = runtime.view.entities.filter(e => e.ownerId === runtime.aiPlayerId && e.kind === "unit" && e.position.x <= 20).sort((a,b) => a.position.x-b.position.x)[0];
  if (threat && (lastCombatTarget !== threat.id || runtime.view.serverTick - lastCombatOrder >= 200)) {
    issue({ type: "attack", entityIds: units.map(e => e.id), targetId: threat.id }, "defend home from visible AI army", false);
    lastCombatOrder = runtime.view.serverTick; lastCombatTarget = threat.id;
  } else if (!threat && (lastCombatTarget !== null || runtime.view.serverTick - lastCombatOrder >= 300)) {
    issue({ type: "move", entityIds: units.map(e => e.id), target: { x: 10, y: 12 } }, "return defenders outside control objective", false);
    issue({ type: "setStance", entityIds: units.map(e => e.id), stance: "holdGround" }, "defenders hold ground", false);
    lastCombatOrder = runtime.view.serverTick; lastCombatTarget = null;
  }
  const shield = units.find(e => e.typeId === "shieldBearer" && e.combatPhase === "ready" && (e.abilityReadyTick ?? 0) <= runtime.view.serverTick);
  if (shield && threat) issue({ type: "castAbility", casterId: shield.id, abilityId: "shieldWall", target: { kind: "self" } }, "shield defenders against visible pressure", false);
}
function support() {
  if (buildingTarget && own().find(e => e.id === buildingTarget)?.complete) {
    buildingWorker = null; buildingTarget = null;
  }
  assignEconomy(); fight();
  for (const type of COMBAT_UNIT_IDS) {
    if (["archer", "boarRider"].includes(type) && runtime.view.settlementTier === "frontier") continue;
    if (["mage", "musketeer", "heavyCrossbowman"].includes(type) && runtime.view.settlementTier !== "artificer") continue;
    const p = producer(UNITS[type].producers[0]!);
    if (!p || (p.ownerControl?.productionQueue.length ?? 5) > 0) continue;
    if (army().filter(e => e.typeId === type).length >= armyDesired[type]) continue;
    if (runtime.view.population.capacity - runtime.view.population.used < UNITS[type].population || !affordable(UNITS[type].cost)) continue;
    issue({ type: "train", producerId: p.id, unitType: type, count: 1 }, `train defensive ${type}`, false);
  }
}
function step() {
  if (runtime.view.serverTick % 20 === 0) support();
  collect(runtime.step(100).events);
  if (runtime.view.serverTick % 1000 === 0) {
    const snapshot = { tick: runtime.view.serverTick, phase: runtime.view.phase, tier: runtime.view.settlementTier, wallet: runtime.view.wallet, population: runtime.view.population, army: army().length, technologies: runtime.view.completedTechnologyIds, control: runtime.view.victory.teams.map(t => ({team:t.teamId,score:t.timedControlScoreTicks})), builders: workers().map(e=>({id:e.id,activity:e.civilianActivity,at:e.position})) };
    report.snapshots.push(snapshot); console.log(JSON.stringify(snapshot));
  }
  assert.ok(performance.now() - started < 240_000, "bounded four-minute wall-clock verification limit");
}
function until(check: () => boolean, limit: number, label: string) {
  const end = runtime.view.serverTick + limit;
  while (!check() && runtime.view.phase === "playing" && runtime.view.serverTick < end) step();
  assert.ok(check(), `${label} not reached by tick ${runtime.view.serverTick}; phase ${runtime.view.phase}`);
  checkpoint(label);
}
function build(type: BuildingType, preferred: {x:number;y:number}) {
  if (producer(type) && type !== "house" && type !== "defenseTower") return;
  until(() => affordable(BUILDINGS[type].cost), 4000, `fund ${type}`);
  const worker = workers().filter(e=>e.id!==buildingWorker).at(-1)!;
  const footprint = getBuildingFootprint(type);
  const visible = new Set(runtime.view.visibleTileIndices);
  const occupied = new Set(runtime.view.entities.filter(e=>e.kind !== "unit").flatMap(e=>e.kind === "building" || e.kind === "rubble" ? getBuildingFootprint(e.typeId as BuildingType,e.orientation).map(o=>`${e.position.x+o.x},${e.position.y+o.y}`) : [`${e.position.x},${e.position.y}`]));
  const candidates: {x:number;y:number}[]=[];
  for(let y=3;y<21;y++) for(let x=2;x<11;x++) {
    const point={x,y};
    if(footprint.every(o=>{const p={x:x+o.x,y:y+o.y};return p.x<12 && visible.has(p.y*32+p.x) && !occupied.has(`${p.x},${p.y}`) && isVillageAssaultBuildableCell(p,"pinehold");})) candidates.push(point);
  }
  candidates.sort((a,b)=>Math.abs(a.x-preferred.x)+Math.abs(a.y-preferred.y)-Math.abs(b.x-preferred.x)-Math.abs(b.y-preferred.y));
  const before = new Set(own().map(e=>e.id));
  const location = candidates.find(origin=>issue({type:"build",builderIds:[worker.id],buildingType:type,origin},`build ${type}`,false));
  assert.ok(location, `legal visible placement for ${type}`);
  buildingWorker=worker.id; assignments.delete(worker.id);
  buildingTarget=own().find(e=>e.kind==="building" && e.typeId===type && !before.has(e.id))!.id;
  const id=buildingTarget;
  until(()=>own().find(e=>e.id===id)?.complete===true,900,`${type} completes`);
  buildingWorker=null; buildingTarget=null; assignEconomy();
  const p=own().find(e=>e.id===id)!;
  if(Object.values(UNITS).some(u=>u.producers.includes(type))) issue({type:"setRallyPoint",producerId:p.id,target:{x:10,y:12}},`${type} defensive rally`,false);
}
function research(technologyId: typeof TECHNOLOGY_ORDER[number]) {
  const definition=TECHNOLOGIES[technologyId];
  until(()=>affordable(definition.cost),5000,`fund ${technologyId}`);
  const p=producer(definition.producer)!;
  issue({type:"research",producerId:p.id,technologyId},`research ${technologyId}`);
  until(()=>runtime.view.completedTechnologyIds.includes(technologyId),1500,`${technologyId} researched`);
}
try {
  assert.deepEqual(runtime.view.victory.policy,VILLAGE_ASSAULT_VICTORY_POLICY);
  // Opening rejection must preserve wallet and provide the genuine prerequisite code.
  const before={...runtime.view.wallet};
  const blocked=runtime.issuePlayerCommand({type:"research",producerId:producer("townCenter")!.id,technologyId:"surveyedFoundations"});
  assert.equal(blocked.rejectCode,"PREREQUISITE_NOT_MET"); assert.deepEqual(runtime.view.wallet,before);
  report.openingResearchRejection={code:blocked.rejectCode,walletUnchanged:true};
  // Assign initial workers deliberately, then expand using ordinary food-funded training.
  workers().forEach((worker,index)=>{
    const kind=(["food","wood","stone"] as const)[index]!;
    const source=runtime.view.entities.find(e=>e.kind==="resource"&&e.typeId===kind&&e.position.x<16)!;
    issue({type:"gather",entityIds:[worker.id],targetId:source.id},`opening ${kind}`);assignments.set(worker.id,kind);
  });
  build("lumberCamp",{x:6,y:9});
  build("farmstead",{x:2,y:9});
  build("house",{x:6,y:7});
  const center=producer("townCenter")!;
  issue({type:"train",producerId:center.id,unitType:"villager",count:5},"train five economy workers");
  build("barracks",{x:7,y:13});
  until(()=>workers().length>=8,900,"eight economy workers trained");
  build("house",{x:6,y:5});
  until(()=>affordable(SETTLEMENT_TIERS.stronghold.cost),5000,"fund stronghold");
  issue({type:"advanceSettlement",producerId:center.id,targetTier:"stronghold"},"advance to stronghold");
  until(()=>runtime.view.settlementTier==="stronghold",600,"stronghold reached");
  build("defenseTower",{x:11,y:10});
  build("defenseTower",{x:11,y:14});
  build("archeryRange",{x:7,y:16});
  build("beastStable",{x:3,y:16});
  build("house",{x:5,y:18});
  research("hearthlandAlmanac");
  research("resinboundKits");
  research("layeredHarness");
  research("surveyedFoundations");
  research("windspurRigging");
  until(()=>affordable(SETTLEMENT_TIERS.artificer.cost),6000,"fund artificer");
  issue({type:"advanceSettlement",producerId:center.id,targetTier:"artificer"},"advance to artificer");
  until(()=>runtime.view.settlementTier==="artificer",700,"artificer reached");
  build("mageSanctum",{x:3,y:5});
  build("gunWorkshop",{x:7,y:5});
  build("siegeWorkshop",{x:7,y:19});
  research("starfireBores");
  research("torsionCradles");
  until(()=>COMBAT_UNIT_IDS.every(id=>report.trainedTypes.includes(id)),2000,"all seven military unit types trained");
  assert.equal(runtime.view.completedTechnologyIds.length,7);
  assert.ok(report.eventCounts.entityDamaged>0,"normal AI caused real combat");
  checkpoint("full progression complete under normal standard AI");
  // Save/load proof is transactional and includes normal AI planner and economy.
  const save=runtime.exportSaveJson();
  fs.mkdirSync(".audit-tmp/r24",{recursive:true});
  fs.writeFileSync(".audit-tmp/r24/full-progression-owner-private-save.json",save);
  const restored=createVillageAssaultRuntime(options);restored.importSaveJson(save);
  assert.equal(hashMatchState(restored.state),hashMatchState(runtime.state));
  const replay=runtime.exportReplayJson();
  fs.writeFileSync(".audit-tmp/r24/full-progression-owner-private-replay.json",replay);
  fs.writeFileSync(".audit-tmp/r24/full-progression-owner-private-journal.json",runtime.exportJournalJson());
  const replayed=createVillageAssaultRuntime(options);replayed.importReplayJson(replay);
  assert.equal(hashMatchState(replayed.state),hashMatchState(runtime.state));
  const ai=runtime.state.players.find(p=>p.id===runtime.aiPlayerId)!;
  report.aiAudit={settlementTier:ai.settlementTier,completedTechnologyIds:ai.completedTechnologyIds,buildings:runtime.state.entities.filter(e=>e.ownerId===ai.id&&e.kind==="building").map(e=>({type:e.typeId,complete:e.kind==="building"&&e.complete})),militaryUnits:runtime.state.entities.filter(e=>e.ownerId===ai.id&&e.kind==="unit"&&e.typeId!=="villager").length,authority:runtime.state.aiControllers.find(a=>a.playerId===ai.id)?.telemetry};
  assert.ok(report.aiAudit.buildings.some((e:any)=>e.type==="barracks"&&e.complete));
  report.result={status:"VERIFIED",tick:runtime.view.serverTick,simulatedSeconds:runtime.view.serverTick/10,tier:runtime.view.settlementTier,technologies:runtime.view.completedTechnologyIds,trainedTypes:report.trainedTypes,saveHashMatches:true,replayHashMatches:true,finalHash:hashMatchState(runtime.state),victory:runtime.view.victory};
} catch(error) {
  process.exitCode=1;
  report.result={status:"FAILED",tick:runtime.view.serverTick,error:error instanceof Error?error.message:String(error),wallet:runtime.view.wallet,tier:runtime.view.settlementTier,victory:runtime.view.victory};
} finally {
  report.wallMilliseconds=Math.round(performance.now()-started);
  fs.mkdirSync("docs/evidence/r24",{recursive:true});
  fs.writeFileSync("docs/evidence/r24/full-progression-playthrough.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,checkpoints:report.checkpoints,deposits:report.deposits,expenditure:report.expenditure,aiAudit:report.aiAudit,accepted:report.commands.filter((c:any)=>c.accepted).length,rejected:report.commands.filter((c:any)=>!c.accepted).length,wallMilliseconds:report.wallMilliseconds},null,2));
}
