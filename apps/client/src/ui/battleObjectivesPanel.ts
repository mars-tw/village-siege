import type { VisibleSnapshot } from "@village-siege/shared";
import { battleObjectiveCards, type BattleObjectiveAction } from "../game/battleObjectives";
import "./battleObjectivesPanel.css";

export interface BattleObjectivesPanelControl {
  open(): void;
  close(): void;
  update(): void;
  setPosition(left: number, top: number): void;
  destroy(): void;
  readonly isOpen: boolean;
}

export function createBattleObjectivesPanel(host: HTMLElement, hooks: {
  snapshot(): VisibleSnapshot;
  action(action: BattleObjectiveAction): boolean;
  opened(): void;
  closed(): void;
  feedback?(): string;
}): BattleObjectivesPanelControl {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "battle-objectives-trigger";
  trigger.textContent = "戰場目標";
  const dialog = document.createElement("dialog");
  dialog.className = "battle-objectives-dialog";
  dialog.setAttribute("aria-label", "戰場目標");
  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = "戰場目標";
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "關閉";
  closeButton.setAttribute("aria-label", "關閉戰場目標");
  header.append(heading, closeButton);
  const summary = document.createElement("p");
  summary.className = "battle-objectives-summary";
  const feedback = document.createElement("output");
  feedback.className = "battle-objectives-feedback";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;
  const cards = document.createElement("div");
  cards.className = "battle-objectives-cards";
  const footer = document.createElement("footer");
  const previous = document.createElement("button");
  const pageText = document.createElement("span");
  const next = document.createElement("button");
  previous.type = next.type = "button";
  previous.textContent = "上一頁";
  next.textContent = "下一頁";
  footer.append(previous, pageText, next);
  dialog.append(header, summary, feedback, cards, footer);
  host.append(trigger, dialog);

  let page = 0;
  let signature = "";
  const pageSize = (): number => window.innerWidth <= 568 && window.innerHeight <= 320 ? 1 : window.innerWidth <= 720 || window.innerHeight <= 460 ? 2 : 3;

  const render = (force = false): void => {
    if (!dialog.open) return;
    const snapshot = hooks.snapshot();
    const entries = battleObjectiveCards(snapshot);
    const perPage = pageSize();
    const pages = Math.max(1, Math.ceil(entries.length / perPage));
    page = Math.min(page, pages - 1);
    const visible = entries.slice(page * perPage, (page + 1) * perPage);
    const nextSignature = JSON.stringify([snapshot.serverTick, snapshot.visibilityRevision, snapshot.phase, page, perPage, visible]);
    if (!force && signature === nextSignature) return;
    signature = nextSignature;
    summary.textContent = `${visible[0]?.stage ?? "目標"} · 第 ${page + 1} / ${pages} 頁`;
    cards.replaceChildren();
    for (const entry of visible) {
      const card = document.createElement("article");
      card.className = "battle-objective-card";
      if (entry.done) card.classList.add("complete");
      card.dataset.objectiveId = entry.id;
      const stage = document.createElement("span");
      stage.className = "battle-objective-stage";
      stage.textContent = entry.stage;
      const title = document.createElement("h3");
      title.textContent = entry.title;
      const detail = document.createElement("p");
      detail.textContent = entry.detail;
      const status = document.createElement("p");
      status.className = "battle-objective-status";
      status.textContent = `${entry.done ? "✓ " : ""}${entry.status}`;
      card.append(stage, title, detail, status);
      if (entry.action && entry.actionLabel) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.actionLabel;
        button.setAttribute("aria-label", `${entry.actionLabel}：${entry.title}`);
        button.onclick = () => {
          if (hooks.action(entry.action!)) close();
          else {
            feedback.textContent = hooks.feedback?.() ?? "目前無法執行，請確認選取、資源與視野";
            feedback.hidden = false;
            render(true);
          }
        };
        card.append(button);
      }
      cards.append(card);
    }
    pageText.textContent = `${page + 1} / ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
  };

  const close = (): void => {
    if (!dialog.open) return;
    dialog.close();
    hooks.closed();
    trigger.focus();
  };
  const open = (): void => {
    if (dialog.open) return;
    page = 0;
    feedback.hidden = true;
    hooks.opened();
    dialog.showModal();
    render(true);
    closeButton.focus();
  };
  trigger.onclick = open;
  closeButton.onclick = close;
  previous.onclick = () => { page -= 1; render(true); };
  next.onclick = () => { page += 1; render(true); };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); event.stopPropagation(); close(); });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  for (const element of [trigger, dialog]) for (const type of ["pointerdown", "pointerup", "wheel"]) element.addEventListener(type, (event) => event.stopPropagation());
  const resize = (): void => render(true);
  window.addEventListener("resize", resize);
  return {
    open, close, update: () => render(),
    setPosition: (left, top) => { trigger.style.left = `${Math.max(6, left)}px`; trigger.style.top = `${Math.max(6, top)}px`; },
    destroy: () => { close(); window.removeEventListener("resize", resize); trigger.remove(); dialog.remove(); },
    get isOpen() { return dialog.open; },
  };
}
