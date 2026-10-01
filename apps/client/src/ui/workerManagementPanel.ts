import type { ResourceKind, VisibleSnapshot } from "@village-siege/shared";
import {
  visibleOwnedWorkers,
  workerManagementPageSize,
  WORKER_RESOURCE_LABELS,
} from "../game/workerManagementPresentation";
import "./workerManagementPanel.css";

export interface WorkerManagementPanelHooks {
  snapshot: VisibleSnapshot;
  select(workerId: string): void;
  assign(workerId: string, resourceKind: ResourceKind): boolean | void;
  opened(): void;
  closed(): void;
  feedback(message: string): void;
}

export interface WorkerManagementPanelControl {
  open(): void;
  close(): void;
  update(snapshot: VisibleSnapshot): void;
  setPosition(left: number, top: number): void;
  destroy(): void;
  readonly isOpen: boolean;
}

export function createWorkerManagementPanel(
  host: HTMLElement,
  hooks: WorkerManagementPanelHooks,
): WorkerManagementPanelControl {
  const dialog = document.createElement("dialog");
  dialog.className = "worker-management-dialog";
  dialog.setAttribute("aria-label", "工匠分工");

  const header = document.createElement("header");
  const title = document.createElement("h2");
  const closeButton = document.createElement("button");
  title.textContent = "工匠分工";
  closeButton.type = "button";
  closeButton.textContent = "關閉";
  closeButton.setAttribute("aria-label", "關閉工匠分工");
  header.append(title, closeButton);

  const summary = document.createElement("p");
  summary.className = "worker-management-summary";
  const feedback = document.createElement("output");
  feedback.className = "worker-management-feedback";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;
  const rows = document.createElement("div");
  rows.className = "worker-management-rows";

  const footer = document.createElement("footer");
  const previous = document.createElement("button");
  const pageText = document.createElement("span");
  const next = document.createElement("button");
  previous.type = next.type = "button";
  previous.textContent = "上一頁";
  next.textContent = "下一頁";
  footer.append(previous, pageText, next);
  dialog.append(header, summary, feedback, rows, footer);
  host.append(dialog);

  let snapshot = hooks.snapshot;
  let page = 0;
  let selectedWorkerId: string | null = null;

  const announce = (message: string): void => {
    feedback.textContent = message;
    feedback.hidden = false;
    hooks.feedback(message);
  };

  const render = (): void => {
    if (!dialog.open) return;
    const workers = visibleOwnedWorkers(snapshot);
    const perPage = workerManagementPageSize(window.innerWidth, window.innerHeight);
    const pages = Math.max(1, Math.ceil(workers.length / perPage));
    page = Math.min(page, pages - 1);
    const visible = workers.slice(page * perPage, (page + 1) * perPage);
    summary.textContent = `可見工匠 ${workers.length} 名 · 每次只指派一名`;
    rows.replaceChildren();

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "worker-management-empty";
      empty.textContent = "目前沒有自己的可見工匠";
      rows.append(empty);
    }

    for (const worker of visible) {
      const row = document.createElement("article");
      row.className = "worker-management-row";
      row.dataset.workerId = worker.id;
      if (selectedWorkerId === worker.id) row.classList.add("selected");

      const identity = document.createElement("div");
      identity.className = "worker-management-identity";
      const heading = document.createElement("h3");
      const detail = document.createElement("p");
      heading.textContent = worker.label;
      detail.textContent = `${worker.activity} · ${worker.cargo}`;
      identity.append(heading, detail);

      const actions = document.createElement("div");
      actions.className = "worker-management-actions";
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.textContent = "選取";
      selectButton.setAttribute("aria-label", `選取${worker.label}`);
      selectButton.setAttribute("aria-pressed", String(selectedWorkerId === worker.id));
      selectButton.onclick = () => {
        selectedWorkerId = worker.id;
        hooks.select(worker.id);
        announce(`已選取${worker.label}`);
        render();
      };
      actions.append(selectButton);

      for (const kind of ["food", "wood", "stone"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = WORKER_RESOURCE_LABELS[kind];
        button.setAttribute("aria-label", `指派${worker.label}${WORKER_RESOURCE_LABELS[kind]}`);
        button.onclick = () => assign(worker.id, worker.label, kind);
        actions.append(button);
      }
      row.append(identity, actions);
      rows.append(row);
    }

    pageText.textContent = `${page + 1} / ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pages;
  };

  const assign = (workerId: string, label: string, kind: ResourceKind): void => {
    const result = hooks.assign(workerId, kind);
    const message = result === false
      ? `${label}目前無法${WORKER_RESOURCE_LABELS[kind]}`
      : `已指派${label}${WORKER_RESOURCE_LABELS[kind]}`;
    announce(message);
  };

  const close = (): void => {
    if (!dialog.open) return;
    dialog.close();
    hooks.closed();
  };

  const open = (): void => {
    if (dialog.open) return;
    feedback.hidden = true;
    page = 0;
    hooks.opened();
    dialog.showModal();
    render();
    closeButton.focus();
  };

  closeButton.onclick = close;
  previous.onclick = () => { page -= 1; render(); };
  next.onclick = () => { page += 1; render(); };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  for (const type of ["pointerdown", "pointerup", "wheel"]) {
    dialog.addEventListener(type, (event) => event.stopPropagation());
  }
  const resize = (): void => render();
  window.addEventListener("resize", resize);

  return {
    open,
    close,
    update: (nextSnapshot) => { snapshot = nextSnapshot; render(); },
    setPosition: (left, top) => {
      dialog.style.setProperty("--worker-panel-left", `${Math.max(6, left)}px`);
      dialog.style.setProperty("--worker-panel-top", `${Math.max(6, top)}px`);
      dialog.classList.add("positioned");
    },
    destroy: () => {
      close();
      window.removeEventListener("resize", resize);
      dialog.remove();
    },
    get isOpen() { return dialog.open; },
  };
}
