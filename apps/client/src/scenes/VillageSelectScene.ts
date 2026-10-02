import Phaser from "phaser";
import { getDeviceViewportProfile } from "../game/deviceViewport";
import { toggleGameFullscreen } from "../game/gameFullscreen";
import { publicAssetUrl } from "../game/publicAssetUrl";
import { multiplayerAvailability } from "../network/multiplayerAvailability";
import { readAutoSave, type AutoSaveEntry } from "../game/autoSave";
import { parseMatchSaveFile, type AiDifficulty } from "@village-siege/shared";
import { idFromPolicy, type BattleModeId } from "../game/battleModes";
import "../frontier-menu.css";
export type VillageId = "pinehold" | "riverstead" | "highcrag";
export type AiPersonality = "aggressor" | "guardian" | "prosperer" | "balanced" | "raider";
const VILLAGES = [
 {id:"pinehold",name:"松林堡",detail:"穿過松林，守住通往村落的隘口。",bonus:"林木與城防",frame:0},
 {id:"riverstead",name:"河谷鎮",detail:"沿河採集，爭奪橋頭與兩岸的通道。",bonus:"河道與採集",frame:5},
 {id:"highcrag",name:"高地寨",detail:"依山築城，利用石材建立防線。",bonus:"石礦與隘道",frame:3},
] as const;
const AI_PROFILES = [
 {id:"aggressor",name:"進攻",detail:"早期集結，迅速出兵"},
 {id:"guardian",name:"守備",detail:"築城、修復，再伺機反攻"},
 {id:"prosperer",name:"發展",detail:"擴張經濟，累積後期兵力"},
 {id:"balanced",name:"均衡",detail:"偵察後調整兵種與進攻時機"},
 {id:"raider",name:"襲擾",detail:"攻擊落單工匠與薄弱據點"},
] as const;
const DIFFICULTIES = [
 {id:"novice",name:"新手",detail:"較長的發展空間，適合熟悉操作。"},
 {id:"standard",name:"標準",detail:"穩定發展與反制，適合完整對戰。"},
 {id:"veteran",name:"老練",detail:"更積極的調度，考驗偵察與配兵。"},
] as const;
const BATTLE_MODES = [
 {id:"siege",name:"攻城戰",detail:"摧毀敵方議事堂或殲滅敵軍，專注完整發展與攻城。"},
 {id:"territory",name:"領土爭奪",detail:"保留議事堂、殲滅、拓界銅標與中域控制四條勝途。"},
] as const;
export class VillageSelectScene extends Phaser.Scene {
 private root?: HTMLElement;
 private villageId: VillageId = "pinehold";
 private aiPersonality: AiPersonality = "balanced";
 private aiDifficulty: AiDifficulty = "standard";
 private battleMode: BattleModeId = "siege";
 private autoSaveNotice = "";
 constructor(){super({key:"VillageSelectScene"});}
 create():void {
  this.cameras.main.setBackgroundColor("#172b29");
  const host=this.game.canvas.parentElement ?? document.body;
  host.classList.add("village-siege-host","selection-active");
  const root=document.createElement("section"); root.className="frontier-menu"; root.setAttribute("aria-label","戰前準備");
  root.style.setProperty("--frontier-cover",`url("${publicAssetUrl("assets/original/frontier/cover.webp")}")`);
  root.style.setProperty("--frontier-atlas",`url("${publicAssetUrl("assets/original/frontier/buildings-menu.webp")}")`);
  root.innerHTML=`
   <div class="frontier-landscape" aria-hidden="true"></div>
   <header class="frontier-header"><div class="frontier-brand"><span class="brand-seal" aria-hidden="true">村</span><span>VILLAGE SIEGE<small>村莊攻防</small></span></div><span class="frontier-version">邊境篇 <span>v${import.meta.env.VITE_APP_VERSION ?? "1.2.0"}</span></span></header>
   <div class="frontier-content">
    <div class="frontier-intro"><p class="frontier-eyebrow">一座村莊，一場攻防。</p><h1>把邊境，<br>變成你的堡壘。</h1><p class="frontier-description">開拓、築城、帶兵出征。<br>從松林深處，打開通往河谷的道路。</p></div>
    <section class="frontier-settings">
     <div class="frontier-section-title"><h2>選擇聚落</h2><span>三片地形，三條進軍路線</span></div>
     <div class="frontier-villages">${VILLAGES.map(v=>`<button type="button" class="frontier-village" data-village="${v.id}" aria-pressed="false"><span class="village-art village-art-${v.frame}" aria-hidden="true"></span><span class="village-name">${v.name}</span><small>${v.bonus}</small><span class="village-check" aria-hidden="true">✓</span></button>`).join("")}</div>
     <p class="frontier-village-detail" data-village-detail></p>
     <div class="frontier-mode"><div class="frontier-section-title"><h2>戰役模式</h2><span>選擇這場的勝利條件</span></div><div class="frontier-mode-buttons">${BATTLE_MODES.map(mode=>`<button type="button" data-battle-mode="${mode.id}" aria-pressed="false"><strong>${mode.name}</strong></button>`).join("")}</div><p data-mode-detail></p></div>
     <div class="frontier-opponent"><div><div class="frontier-section-title"><h2>對手風格</h2></div><div class="frontier-pills">${AI_PROFILES.map(p=>`<button type="button" data-ai="${p.id}" aria-pressed="false" title="${p.detail}">${p.name}</button>`).join("")}</div></div><div><div class="frontier-section-title"><h2>難度</h2></div><div class="frontier-pills difficulty-pills">${DIFFICULTIES.map(d=>`<button type="button" data-difficulty="${d.id}" aria-pressed="false" title="${d.detail}">${d.name}</button>`).join("")}</div></div></div>
     <p class="frontier-rival-detail" data-rival-detail></p>
    </section>
    <footer class="frontier-actions"><button type="button" class="frontier-start" data-start><span>開始戰役</span><span aria-hidden="true">→</span></button><div class="frontier-secondary"><button type="button" data-tutorial>新手教學 <span>↗</span></button>${multiplayerAvailability.enabled?`<button type="button" data-multiplayer>私人連線 <span>↗</span></button>`:""}<button type="button" data-guide>操作指南 <span>?</span></button></div></footer>
   </div>
   <aside class="frontier-world-note" aria-label="戰役概要"><span>THE FRONTIER</span><h2>河谷的晨光</h2><p>三座聚落 · 七種兵種 · 四條勝途</p><div class="world-note-rule"></div><small>發展經濟，突破城防，或守住中域。</small></aside>
   <div class="frontier-bottom"><span>原創等角即時戰略</span><output class="frontier-readout" aria-live="polite"></output><span class="frontier-device-note">滑鼠鍵盤／觸控操作</span></div>
   <dialog class="frontier-guide"><div class="guide-heading"><h2>把第一座村莊守好</h2><button type="button" data-close-guide aria-label="關閉操作指南">×</button></div><div class="guide-body"><p><strong>先發展：</strong>點選工匠，再點林木、糧食或石礦。選取主城可訓練更多工匠。</p><p><strong>再出兵：</strong>建造兵營並訓練士兵。點「科技與時代」查看建築與材料前置，升級後開放弓箭、騎兵與攻城兵器。</p><p><strong>電腦：</strong>點選單位，按住 Shift 拖曳框選，右鍵移動／攻擊；WASD 或拖曳移動鏡頭，滾輪縮放，B 建造，P 暫停。</p><p><strong>手機／平板：</strong>戰場採橫向。點選單位後點目標，拖曳移動鏡頭，用縮放按鈕拉近、拉遠；底部指令可選工匠、全軍、建造與系統。</p><p><strong>贏得戰役：</strong>摧毀敵方議事堂、殲滅敵軍、持守拓界銅標，或取得中域控制。</p></div><button type="button" class="guide-play" data-guide-tutorial>用七個目標學會操作 →</button></dialog>`;
  host.append(root);this.root=root;
  root.querySelectorAll<HTMLButtonElement>("[data-village]").forEach(b=>b.addEventListener("click",()=>{this.villageId=b.dataset.village as VillageId;this.syncSelection();}));
  root.querySelectorAll<HTMLButtonElement>("[data-ai]").forEach(b=>b.addEventListener("click",()=>{this.aiPersonality=b.dataset.ai as AiPersonality;this.syncSelection();}));
  root.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach(b=>b.addEventListener("click",()=>{this.aiDifficulty=b.dataset.difficulty as AiDifficulty;this.syncSelection();}));
  root.querySelectorAll<HTMLButtonElement>("[data-battle-mode]").forEach(b=>b.addEventListener("click",()=>{this.battleMode=b.dataset.battleMode as BattleModeId;this.syncSelection();}));
  root.querySelector("[data-start]")?.addEventListener("click",()=>this.startBattle(false));
  root.querySelector("[data-tutorial]")?.addEventListener("click",()=>this.startBattle(true));
  root.querySelector("[data-guide-tutorial]")?.addEventListener("click",()=>this.startBattle(true));
  root.querySelector("[data-multiplayer]")?.addEventListener("click",()=>this.scene.start("MultiplayerLobbyScene",{villageId:this.villageId}));
  const guide=root.querySelector<HTMLDialogElement>("dialog")!;
  root.querySelector("[data-guide]")?.addEventListener("click",()=>guide.showModal());
  root.querySelector("[data-close-guide]")?.addEventListener("click",()=>guide.close());
  this.autoSaveNotice="";
  this.syncSelection();this.events.once("shutdown",this.destroySelector,this);this.events.once("destroy",this.destroySelector,this);
  void this.loadContinueBattle(root);
  window.dispatchEvent(new Event("village-siege-ready"));
 }
 private startBattle(tutorial:boolean):void {
  const p=getDeviceViewportProfile(); if(p.mobile&&!this.scale.isFullscreen)toggleGameFullscreen(this);
  this.scene.start("VillageAssaultScene",{villageId:tutorial?"pinehold":this.villageId,aiPersonality:tutorial?"balanced":this.aiPersonality,aiDifficulty:tutorial?"novice":this.aiDifficulty,battleMode:tutorial?"territory":this.battleMode,returnScene:"VillageSelectScene",tutorial});
 }
 private async loadContinueBattle(root:HTMLElement):Promise<void> {
  const result=await readAutoSave();
  if(this.root!==root||!this.sys.isActive())return;
  if(!result.ok){this.autoSaveNotice="自動存檔不可用";this.syncSelection();root.querySelector(".frontier-readout")?.setAttribute("title",result.message);return;}
  const entry=result.latest;
  this.autoSaveNotice=entry&&!entry.finished?"有未完戰役可繼續":"自動存檔可用";
  this.syncSelection();
  if(result.warning)root.querySelector(".frontier-readout")?.setAttribute("title",result.warning);
  if(!entry||entry.finished)return;
  const button=document.createElement("button");button.type="button";button.dataset.continue="";
  button.textContent="繼續戰役 ↗";button.setAttribute("aria-label",`繼續上次未完成戰役，進度 ${Math.floor(entry.tick/10)} 秒`);
  button.addEventListener("click",()=>this.continueBattle(entry));
  root.querySelector(".frontier-secondary")?.prepend(button);
 }
 private continueBattle(entry:AutoSaveEntry):void {
  const p=getDeviceViewportProfile();if(p.mobile&&!this.scale.isFullscreen)toggleGameFullscreen(this);
  const battleMode=idFromPolicy(parseMatchSaveFile(entry.saveJson).snapshot.state.victory.policy);
  this.scene.start("VillageAssaultScene",{villageId:this.villageId,aiPersonality:this.aiPersonality,aiDifficulty:this.aiDifficulty,battleMode,returnScene:"VillageSelectScene",tutorial:false,continueSaveJson:entry.saveJson});
 }
 private syncSelection():void {
  if(!this.root)return;
  const groups:[[string,string,string],[string,string,string],[string,string,string],[string,string,string]]=[["[data-village]","village",this.villageId],["[data-ai]","ai",this.aiPersonality],["[data-difficulty]","difficulty",this.aiDifficulty],["[data-battle-mode]","battleMode",this.battleMode]];
  for(const [selector,key,current] of groups)this.root.querySelectorAll<HTMLButtonElement>(selector).forEach(b=>{const selected=b.dataset[key]===current;b.classList.toggle("is-selected",selected);b.setAttribute("aria-pressed",String(selected));});
  const v=VILLAGES.find(v=>v.id===this.villageId)!;const p=AI_PROFILES.find(p=>p.id===this.aiPersonality)!;const d=DIFFICULTIES.find(d=>d.id===this.aiDifficulty)!;const mode=BATTLE_MODES.find(mode=>mode.id===this.battleMode)!;
  this.root.querySelector("[data-village-detail]")!.textContent=v.detail;
  this.root.querySelector("[data-mode-detail]")!.textContent=mode.detail;
  this.root.querySelector("[data-rival-detail]")!.textContent=`${p.detail}。${d.detail}`;
  this.root.querySelector(".frontier-readout")!.textContent=`${v.name} ／ ${mode.name} ／ ${p.name} ／ ${d.name}${this.autoSaveNotice?` ／ ${this.autoSaveNotice}`:""}`;
 }
 private destroySelector():void {this.root?.querySelector<HTMLDialogElement>("dialog")?.close();this.root?.remove();(this.game.canvas.parentElement??document.body).classList.remove("selection-active");this.root=undefined;}
}
export default VillageSelectScene;
