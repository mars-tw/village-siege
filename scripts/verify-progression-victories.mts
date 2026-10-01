import assert from "node:assert/strict";
import fs from "node:fs";
import { createVillageAssaultRuntime, VILLAGE_ASSAULT_VICTORY_POLICY } from "../apps/client/src/game/villageAssaultRuntime.ts";
import { getBuildingFootprint, hashMatchState, isVillageAssaultBuildableCell, isVillageAssaultWalkableCell, RULES_VERSION, UNITS, type BuildingType, type GameCommand } from "@village-siege/shared";

// Continues the genuine save produced by verify-full-progression.mts. Each
// route starts from the same player-earned economy/technology checkpoint and
// submits only ordinary visible player commands. The AI and victory policy are
// inherited unchanged from the save.
const save=fs.readFileSync(".audit-tmp/r24/full-progression-owner-private-save.json","utf8");
const options={playerVillageId:"pinehold",aiVillageId:"riverstead",aiPersonality:"balanced",aiDifficulty:"standard",seed:230501,matchId:"full-progression-standard-ai"} as const;
const reportPath="docs/evidence/r24/full-progression-victories.json";
const requestedRoute=process.argv[2];
const report:any=requestedRoute&&fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,"utf8")):{rulesVersion:RULES_VERSION,method:"Four branches of an earned save; public commands, VisibleSnapshot decisions, standard AI, default unchanged four-route victory policy.",routes:[]};
function run(route:"timedControl"|"landmark"|"conquest"|"elimination") {
  const runtime=createVillageAssaultRuntime(options);runtime.importSaveJson(save);
  assert.deepEqual(runtime.view.victory.policy,VILLAGE_ASSAULT_VICTORY_POLICY);
  const item:any={route,startTick:runtime.view.serverTick,startHash:hashMatchState(runtime.state),commands:[],combatEvents:0};
  const own=()=>runtime.view.entities.filter(e=>e.ownerId===runtime.playerId);
  const army=()=>own().filter(e=>e.kind==="unit"&&e.typeId!=="villager");
  const initialArmyIds=new Set(army().map(e=>e.id));
  const reinforcementStages=new Map<string,"north"|"east"|"assault">();
  function issue(command:GameCommand,label:string,required=true){const r=runtime.issuePlayerCommand(command);item.commands.push({tick:runtime.view.serverTick,label,command,accepted:r.accepted,rejectCode:r.rejectCode});if(required)assert.equal(r.accepted,true,`${label}: ${r.rejectCode}`);return r.accepted;}
  function step(){
    const r=runtime.step(100);item.combatEvents+=r.events.filter(e=>e.type==="entityDamaged").length;
    if(route==="elimination"&&runtime.view.phase==="playing"&&runtime.view.serverTick%20===0){
      for(const type of ["mage","heavyCrossbowman"] as const){
        const p=own().find(e=>e.kind==="building"&&e.complete&&UNITS[type].producers.includes(e.typeId as BuildingType));
        const cost=UNITS[type].cost;
        if(p&&(p.ownerControl?.productionQueue.length??5)<1&&army().filter(e=>e.typeId===type).length<4&&runtime.view.population.used+UNITS[type].population<=runtime.view.population.capacity&&runtime.view.wallet.food>=cost.food&&runtime.view.wallet.wood>=cost.wood&&runtime.view.wallet.stone>=cost.stone)issue({type:"train",producerId:p.id,unitType:type,count:1},`economy-funded elimination ${type}`,false);
      }
      for(const unit of army().filter(e=>!initialArmyIds.has(e.id))){
        let stage=reinforcementStages.get(unit.id);
        if(!stage){issue({type:"move",entityIds:[unit.id],target:{x:10,y:8}},"stage replacement north of control circle",false);reinforcementStages.set(unit.id,"north");}
        else if(stage==="north"&&unit.position.y<=9){issue({type:"move",entityIds:[unit.id],target:{x:23,y:8}},"move paid replacement through north ford",false);reinforcementStages.set(unit.id,"east");}
        else if(stage==="east"&&unit.position.x>=20)reinforcementStages.set(unit.id,"assault");
      }
      const shield=army().find(e=>e.typeId==="shieldBearer"&&e.combatPhase==="ready"&&(e.abilityReadyTick??0)<=runtime.view.serverTick);
      if(shield&&runtime.view.entities.some(e=>e.ownerId===runtime.aiPlayerId&&e.kind==="unit"&&Math.hypot(e.position.x-shield.position.x,e.position.y-shield.position.y)<7))issue({type:"castAbility",casterId:shield.id,abilityId:"shieldWall",target:{kind:"self"}},"protect the elimination front line",false);
    }
  }
  function until(check:()=>boolean,limit:number,label:string){const end=runtime.view.serverTick+limit;while(!check()&&runtime.view.phase==="playing"&&runtime.view.serverTick<end)step();assert.ok(check(),`${route}: ${label} at ${runtime.view.serverTick} phase ${runtime.view.phase}`);}
  try {
    issue({type:"setFormation",entityIds:army().map(e=>e.id),formation:"box"},"compact army formation");
    issue({type:"setStance",entityIds:army().map(e=>e.id),stance:"holdGround"},"hold chosen route without pursuit");
    if(route==="timedControl"){
      issue({type:"move",entityIds:army().map(e=>e.id),target:{x:16,y:12}},"occupy central objective");
      until(()=>runtime.view.phase==="finished",2000,"default timed control finish");
    }else if(route==="landmark"){
      issue({type:"move",entityIds:army().map(e=>e.id),target:{x:8,y:12}},"defend away from control objective");
      const worker=own().find(e=>e.kind==="unit"&&e.typeId==="villager")!;
      const occupied=new Set(runtime.view.entities.filter(e=>e.kind!=="unit").flatMap(e=>e.kind==="building"||e.kind==="rubble"?getBuildingFootprint(e.typeId as BuildingType,e.orientation).map(o=>`${e.position.x+o.x},${e.position.y+o.y}`):[`${e.position.x},${e.position.y}`]));
      const visible=new Set(runtime.view.visibleTileIndices);
      let built=false;
      for(let y=4;y<=20&&!built;y++)for(let x=2;x<=10&&!built;x++){
        const origin={x,y};
        if(getBuildingFootprint("copperLandmark").every(o=>{const p={x:x+o.x,y:y+o.y};return visible.has(p.y*32+p.x)&&!occupied.has(`${p.x},${p.y}`)&&isVillageAssaultBuildableCell(p,"pinehold");}))built=issue({type:"build",builderIds:[worker.id],buildingType:"copperLandmark",origin},"build earned copper landmark",false);
      }
      assert.ok(built,"visible legal landmark placement");
      until(()=>runtime.view.phase==="finished",3000,"default landmark finish");
    }else{
      if(route==="elimination"){
        const worker=own().find(e=>e.kind==="unit"&&e.typeId==="villager")!;
        const houses=own().filter(e=>e.kind==="building"&&e.typeId==="house"&&e.complete).length;
        const built=[{x:6,y:15},{x:6,y:8},{x:9,y:18},{x:2,y:18},{x:3,y:3}].some(origin=>issue({type:"build",builderIds:[worker.id],buildingType:"house",origin},"add paid siege-army population space",false));
        assert.ok(built,"elimination army housing");
        until(()=>own().filter(e=>e.kind==="building"&&e.typeId==="house"&&e.complete).length>houses,700,"siege army house completes");
      }
      // Explicit waypoints keep the long-range army outside the central control
      // circle while crossing the north ford toward the observed enemy home.
      issue({type:"stop",entityIds:army().map(e=>e.id)},"stop previous defensive pursuit");
      for(const unit of army().filter(e=>e.position.x>12))issue({type:"move",entityIds:[unit.id],target:{x:12,y:unit.position.y}},"pull defender west before turning north");
      until(()=>army().every(e=>e.position.x<=12),500,"all defenders west of control circle");
      const occupied=new Set(runtime.view.entities.filter(e=>e.kind!=="unit").flatMap(e=>e.kind==="building"||e.kind==="rubble"?getBuildingFootprint(e.typeId as BuildingType,e.orientation).map(o=>`${e.position.x+o.x},${e.position.y+o.y}`):[`${e.position.x},${e.position.y}`]));
      const targets:{x:number;y:number}[]=[];
      for(let y=7;y>=3;y--)for(let x=2;x<=11;x++)if(isVillageAssaultWalkableCell({x,y},"pinehold")&&!occupied.has(`${x},${y}`))targets.push({x,y});
      for(const [index,unit] of army().filter(e=>initialArmyIds.has(e.id)).entries())issue({type:"move",entityIds:[unit.id],target:targets[index]!},"individual north staging waypoint");
      until(()=>army().filter(e=>initialArmyIds.has(e.id)).every(e=>e.position.y<=8),1200,"north staging");
      for(const [index,unit] of army().filter(e=>initialArmyIds.has(e.id)).entries())issue({type:"move",entityIds:[unit.id],target:{x:20+index%7,y:7+Math.floor(index/7)}},"cross northern ford above control circle");
      until(()=>army().filter(e=>e.position.x>=18).length>=Math.min(6,army().length),900,"enemy side reached");
      let last:string|null=null;let lastTick=-300;
      while(runtime.view.phase==="playing"&&runtime.view.serverTick<16000){
        if(runtime.view.serverTick%20===0){
          const visible=runtime.view.entities.filter(e=>e.ownerId===runtime.aiPlayerId&&e.kind!=="rubble");
          const units=visible.filter(e=>e.kind==="unit").sort((a,b)=>Number(a.typeId==="villager")-Number(b.typeId==="villager"));
          const center=visible.find(e=>e.kind==="building"&&e.typeId==="townCenter");
          // Elimination removes army, villagers and every essential producer
          // first, leaving the command center until last so conquest cannot
          // expire before the final structure is actually destroyed.
          const targets=route==="conquest" ? [center,...units].filter(Boolean) : [...units,...visible.filter(e=>e.kind==="building"&&e.typeId!=="townCenter"),center].filter(Boolean);
          const target=targets[0];
          if(target&&(last!==target.id||runtime.view.serverTick-lastTick>200)){
            const attackers=army().filter(e=>initialArmyIds.has(e.id)||reinforcementStages.get(e.id)==="assault");
            if(attackers.length)issue({type:"attack",entityIds:attackers.map(e=>e.id),targetId:target.id},`attack visible ${target.typeId}`,false);last=target.id;lastTick=runtime.view.serverTick;
          } else if(!target&&army().length&&runtime.view.serverTick-lastTick>200){
            issue({type:"attackMove",entityIds:army().map(e=>e.id),target:{x:26,y:11}},"explore enemy home",false);lastTick=runtime.view.serverTick;
          }
        }
        step();
      }
    }
    assert.equal(runtime.view.phase,"finished");
    assert.ok(runtime.view.victory.winningTeamIds.includes("team-player"));
    assert.equal(runtime.view.victory.finishReason,route);
    const replay=runtime.exportReplayJson();
    const restored=createVillageAssaultRuntime(options);restored.importReplayJson(replay);
    assert.equal(hashMatchState(restored.state),hashMatchState(runtime.state));
    fs.writeFileSync(`.audit-tmp/r24/full-progression-${route}-owner-private-replay.json`,replay);
    item.result={status:"VERIFIED",tick:runtime.view.serverTick,elapsedSeconds:(runtime.view.serverTick-item.startTick)/10,victory:runtime.view.victory,replayHashMatches:true,finalHash:hashMatchState(runtime.state)};
  }catch(error){process.exitCode=1;item.result={status:"FAILED",tick:runtime.view.serverTick,error:error instanceof Error?error.message:String(error),victory:runtime.view.victory,army:army().map(e=>({id:e.id,type:e.typeId,position:e.position,hitPoints:e.hitPoints}))};}
  report.routes=report.routes.filter((existing:any)=>existing.route!==route);report.routes.push(item);
  fs.mkdirSync("docs/evidence/r24",{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({route,...item.result,commands:item.commands.length,combatEvents:item.combatEvents}));
}
for(const route of ["timedControl","landmark","conquest","elimination"] as const)if(!requestedRoute||requestedRoute===route)run(route);
