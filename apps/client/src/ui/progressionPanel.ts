import { progressionCards, ERA_NAMES, type ProgressionAction, type ProgressionTab } from "../game/progressionPresentation";
import type { VisibleSnapshot } from "@village-siege/shared";
import "./progressionPanel.css";

export interface ProgressionPanelControl {
  open(): void; close(): void; update(): void; setPosition(left: number, top: number): void; destroy(): void;
  readonly isOpen: boolean;
}
export function createProgressionPanel(parent: HTMLElement, hooks: {
  snapshot(): VisibleSnapshot; action(action: ProgressionAction): boolean;
  feedback?(): string;
  opened(): void; closed(): void;
}): ProgressionPanelControl {
  const trigger = document.createElement("button");
  trigger.type = "button"; trigger.className = "progression-trigger"; trigger.textContent = "科技與時代";
  const dialog = document.createElement("dialog");
  dialog.className = "progression-dialog"; dialog.setAttribute("aria-label", "科技與時代");
  const header = document.createElement("header"), title = document.createElement("h2"), closeButton = document.createElement("button");
  title.textContent = "科技與時代"; closeButton.textContent = "關閉"; closeButton.type = "button"; closeButton.setAttribute("aria-label", "關閉科技與時代");
  header.append(title, closeButton);
  const tabs = document.createElement("nav"); tabs.setAttribute("aria-label", "發展分類");
  const summary = document.createElement("p"); summary.className = "progression-summary";
  const feedback = document.createElement("output"); feedback.className = "progression-feedback"; feedback.setAttribute("role", "status"); feedback.hidden = true;
  const cards = document.createElement("div"); cards.className = "progression-cards";
  const footer = document.createElement("footer"), previous = document.createElement("button"), next = document.createElement("button"), pageText = document.createElement("span");
  previous.textContent = "上一頁"; next.textContent = "下一頁"; previous.type = next.type = "button";
  footer.append(previous, pageText, next); dialog.append(header, tabs, summary, feedback, cards, footer); parent.append(trigger, dialog);
  let tab: ProgressionTab = "era", page = 0, revision = "";
  const tabButtons = new Map<ProgressionTab, HTMLButtonElement>();
  for (const [key, label] of [["era","時代"],["economy","經濟"],["military","軍備"],["artificer","工藝"]] as const) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.onclick = () => { tab = key; page = 0; render(true); }; tabs.append(button); tabButtons.set(key,button);
  }
  function perform(action: ProgressionAction) {
    if (action.kind === "tab") { tab = action.tab; page = 0; render(true); return; }
    if (hooks.action(action)) close();
    else { feedback.textContent = hooks.feedback?.() ?? "請確認工匠、材料與建築前置"; feedback.hidden = false; render(true); }
  }
  function render(force = false) {
    if (!dialog.open) return;
    const snapshot = hooks.snapshot(), entries = progressionCards(snapshot, tab), perPage = innerHeight <= 360 ? 1 : innerHeight <= 520 ? 2 : 4;
    page = Math.min(page, Math.max(0,Math.ceil(entries.length / perPage) - 1));
    const visible = entries.slice(page * perPage, (page + 1) * perPage);
    const key = JSON.stringify([snapshot.settlementTier, snapshot.wallet, visible, tab, page, perPage]);
    if (!force && key === revision) return; revision = key;
    summary.textContent = `${ERA_NAMES[snapshot.settlementTier]} · 糧 ${Math.floor(snapshot.wallet.food)}　木 ${Math.floor(snapshot.wallet.wood)}　石 ${Math.floor(snapshot.wallet.stone)}`;
    for (const [key, button] of tabButtons) button.setAttribute("aria-pressed", String(key === tab));
    const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.progressAction : undefined;
    cards.replaceChildren();
    for (const entry of visible) {
      const card = document.createElement("article"); card.className = "progression-card"; card.dataset.progression = entry.id;
      const heading = document.createElement("h3"), detail = document.createElement("p"), cost = document.createElement("p"), status = document.createElement("p"), needs = document.createElement("div"), action = document.createElement("button");
      heading.textContent = entry.title; detail.textContent = entry.detail; cost.textContent = entry.cost; cost.className = "progression-cost";
      status.textContent = entry.status; status.className = "progression-status";
      needs.className = "progression-needs";
      for (const need of entry.needs) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = `${need.done ? "✓" : "+"} ${need.label}`; button.className = need.done ? "complete" : "missing";
        button.disabled = need.done || !need.action;
        button.dataset.progressAction = `${entry.id}:${need.label}`;
        if (need.action) button.onclick = () => perform(need.action!);
        needs.append(button);
      }
      action.type = "button"; action.className = "progression-start"; action.textContent = entry.actionLabel;
      action.disabled = !entry.action; action.setAttribute("aria-label", `${entry.actionLabel}：${entry.title}`);
      action.dataset.progressAction = `${entry.id}:start`;
      if (entry.action) action.onclick = () => perform(entry.action!);
      card.append(heading,detail,cost,status,needs,action); cards.append(card);
    }
    const pages = Math.max(1, Math.ceil(entries.length / perPage)); pageText.textContent = `${page + 1} / ${pages}`;
    previous.disabled = page === 0; next.disabled = page + 1 >= pages;
    if (focused) [...cards.querySelectorAll<HTMLButtonElement>("button")].find(button => button.dataset.progressAction === focused && !button.disabled)?.focus();
  }
  function close() {
    if (!dialog.open) return; dialog.close(); hooks.closed(); trigger.focus();
  }
  function open() {
    if (dialog.open) return; feedback.hidden = true; hooks.opened(); dialog.showModal(); render(true); closeButton.focus();
  }
  trigger.onclick = open; closeButton.onclick = close;
  previous.onclick = () => { page--; render(true); }; next.onclick = () => { page++; render(true); };
  dialog.addEventListener("cancel", event => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  for (const element of [trigger,dialog]) for (const type of ["pointerdown","pointerup","wheel"]) element.addEventListener(type, event => event.stopPropagation());
  const resize = () => render(true); window.addEventListener("resize", resize);
  return { open, close, update: () => render(), get isOpen() { return dialog.open; },
    setPosition: (left,top) => { trigger.style.left = `${left}px`; trigger.style.top = `${top}px`; },
    destroy: () => { close(); window.removeEventListener("resize",resize); trigger.remove(); dialog.remove(); },
  };
}
