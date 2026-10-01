import { TECHNOLOGIES, type DomainEvent, type VisibleSnapshot } from "@village-siege/shared";
import { buildingDisplayName } from "../game/buildingNames";
import { ERA_NAMES } from "../game/progressionPresentation";
import type { BattleSound } from "../game/battleAudio";
import { isPublicBuilding, isPublicUnit } from "../game/assaultPublicPresentation";
import "./battleFeedback.css";

const UNIT_NAMES = { villager: "工匠", warrior: "戰士", shieldBearer: "持盾槍衛", archer: "弓箭手", mage: "法師", musketeer: "火槍兵", boarRider: "野豬騎士", heavyCrossbowman: "重弩攻手" } as const;

export function createBattleFeedback(host: HTMLElement, initial: VisibleSnapshot, sound: (kind: BattleSound) => void) {
  const output = document.createElement("output"); output.className = "battle-feedback"; output.hidden = true; output.setAttribute("aria-live", "polite"); host.append(output);
  const completed = new Set(initial.entities.filter(entity => entity.kind === "building" && entity.ownerId === initial.recipientPlayerId && entity.complete).map(entity => entity.id));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activePriority = 0, visibleUntil = 0, lastAttack = -Infinity, deposits = 0;
  const show = (message: string, priority: number, cue: BattleSound) => {
    if (Date.now() < visibleUntil && priority < activePriority) return;
    if (timer) clearTimeout(timer);
    output.textContent = message; output.hidden = false; output.classList.toggle("battle-feedback-warning", priority >= 2);
    activePriority = priority; visibleUntil = Date.now() + (priority >= 2 ? 7000 : 4000); sound(cue);
    timer = setTimeout(() => { output.hidden = true; }, priority >= 2 ? 7000 : 4000);
  };
  return {
    consume(events: readonly DomainEvent[], view: VisibleSnapshot) {
      for (const event of events) {
        if (event.type === "projectileImpacted") sound("impact");
        if (event.type === "entitySpawned" && isPublicUnit(event.entity) && event.entity.ownerId === view.recipientPlayerId) show(`${UNIT_NAMES[event.entity.typeId]}出營，可前往集結點`, 1, "ready");
        if (event.type === "settlementAdvanced" && event.playerId === view.recipientPlayerId) show(`已進入${ERA_NAMES[event.settlementTier]}，新兵種與建築開放`, 1, "advance");
        if (event.type === "technologyResearched" && event.playerId === view.recipientPlayerId) show(`${TECHNOLOGIES[event.technologyId].displayName}研究完成`, 1, "advance");
        if (event.type === "entityRemoved" && event.entity.ownerId === view.recipientPlayerId && event.reason === "destroyed") show(`${isPublicUnit(event.entity) ? UNIT_NAMES[event.entity.typeId] : isPublicBuilding(event.entity) ? buildingDisplayName(event.entity.typeId) : "我方單位"}已失守`, 3, "warning");
        if (event.type === "entityDamaged" && Date.now() - lastAttack > 7000) {
          const target = view.entities.find(entity => entity.id === event.targetId);
          if (target?.ownerId === view.recipientPlayerId) { lastAttack = Date.now(); show("敵軍來襲！查看受損單位並調兵防守", 2, "warning"); }
        }
        if (event.type === "resourcesDeposited" && event.playerId === view.recipientPlayerId && deposits++ < 3) show(`材料已送回：${{food: "糧", wood: "木", stone: "石"}[event.resourceKind]} +${event.amount}，已加入庫存`, 0, "command");
      }
      for (const entity of view.entities) if (isPublicBuilding(entity) && entity.ownerId === view.recipientPlayerId && entity.complete && !completed.has(entity.id)) {
        completed.add(entity.id); show(`${buildingDisplayName(entity.typeId)}完工`, 1, "ready");
      }
    },
    setTop(top: number) { output.style.top = `${top}px`; },
    destroy() { if (timer) clearTimeout(timer); output.remove(); },
  };
}
