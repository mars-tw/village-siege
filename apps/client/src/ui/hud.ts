import type Phaser from "phaser";
import "../style.css";

export interface HudResources {
  readonly wood: number;
  readonly food: number;
  readonly stone: number;
  readonly population?:
    | number
    | { readonly used: number; readonly capacity: number };
}

export interface HudSelection {
  readonly name: string;
  readonly kind?: string;
  readonly owner?: string;
  readonly hitPoints?: number;
  readonly maxHitPoints?: number;
  readonly attack?: number;
  readonly armor?: number;
  readonly armorClass?: string;
  readonly damageType?: string;
  readonly range?: number;
  readonly ability?: string;
  readonly passive?: string;
  readonly counterHint?: string;
  readonly detail?: string;
}

export interface HudAbility {
  readonly name: string;
  readonly description: string;
  readonly hotkey?: string;
  readonly cooldownRemaining?: number;
  readonly cooldownTotal?: number;
  readonly disabled?: boolean;
}

export type HudStatusTone =
  | "neutral"
  | "info"
  | "ready"
  | "success"
  | "warning"
  | "danger"
  | "paused";

export interface HudController {
  updateResources(resources: HudResources): void;
  updateSelection(selection: HudSelection | null): void;
  setAbility(ability: HudAbility | null, onActivate?: () => void): void;
  setStatus(message: string, tone?: HudStatusTone): void;
  destroy(): void;
}

const STATUS_MARKS: Record<HudStatusTone, string> = {
  neutral: "—",
  info: "—",
  ready: "✓",
  success: "✓",
  warning: "!",
  danger: "×",
  paused: "Ⅱ",
};

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`HUD element missing: ${selector}`);
  }
  return element;
}

/**
 * Creates the DOM HUD above the Phaser canvas. Values are always assigned with
 * textContent so server-fed names and status messages cannot inject markup.
 */
export function createHud(scene: Phaser.Scene): HudController {
  const host = scene.game.canvas.parentElement ?? document.body;
  host.classList.add("village-siege-host");

  const root = document.createElement("section");
  root.className = "game-hud";
  root.setAttribute("aria-label", "戰況介面");
  root.innerHTML = `
    <div class="hud-resource-bar" aria-label="資源">
      <output class="hud-resource" data-resource="wood" tabindex="0"><span class="resource-mark" aria-hidden="true">▥</span><span class="resource-label">木材</span><strong>0</strong></output>
      <output class="hud-resource" data-resource="food" tabindex="0"><span class="resource-mark" aria-hidden="true">●</span><span class="resource-label">食物</span><strong>0</strong></output>
      <output class="hud-resource" data-resource="stone" tabindex="0"><span class="resource-mark" aria-hidden="true">◆</span><span class="resource-label">石料</span><strong>0</strong></output>
      <output class="hud-resource" data-resource="population" tabindex="0"><span class="resource-mark" aria-hidden="true">♟</span><span class="resource-label">人口</span><strong>0</strong></output>
    </div>
    <aside class="hud-selection-panel" tabindex="0" aria-label="目前選取">
      <span class="hud-kicker">選取</span>
      <strong class="hud-selection-name">尚未選取</strong>
      <span class="hud-selection-kind">框選單位或建築以查看資訊</span>
      <dl class="hud-selection-details"></dl>
      <button class="hud-ability" type="button" data-ability hidden>
        <span class="hud-ability-key">Q</span>
        <span><strong class="hud-ability-name">技能</strong><small class="hud-ability-detail"></small></span>
        <span class="hud-ability-cooldown" aria-hidden="true"></span>
      </button>
    </aside>
    <output class="hud-status" data-tone="neutral" role="status" aria-live="polite" tabindex="0">
      <span class="hud-status-mark" aria-hidden="true">—</span>
      <span class="hud-status-copy">等待命令</span>
    </output>
  `;
  host.append(root);

  const resourceValues = new Map<string, HTMLElement>(
    ["wood", "food", "stone", "population"].map((key) => [
      key,
      requireElement<HTMLElement>(root, `[data-resource="${key}"] strong`),
    ] as const),
  );
  const resourceOutputs = new Map<string, HTMLOutputElement>(
    ["wood", "food", "stone", "population"].map((key) => [
      key,
      requireElement<HTMLOutputElement>(root, `[data-resource="${key}"]`),
    ] as const),
  );
  const selectionName = requireElement<HTMLElement>(root, ".hud-selection-name");
  const selectionKind = requireElement<HTMLElement>(root, ".hud-selection-kind");
  const selectionDetails = requireElement<HTMLDListElement>(
    root,
    ".hud-selection-details",
  );
  const status = requireElement<HTMLOutputElement>(root, ".hud-status");
  const statusMark = requireElement<HTMLElement>(root, ".hud-status-mark");
  const statusCopy = requireElement<HTMLElement>(root, ".hud-status-copy");
  const abilityButton = requireElement<HTMLButtonElement>(root, "[data-ability]");
  const abilityKey = requireElement<HTMLElement>(root, ".hud-ability-key");
  const abilityName = requireElement<HTMLElement>(root, ".hud-ability-name");
  const abilityDetail = requireElement<HTMLElement>(root, ".hud-ability-detail");
  const abilityCooldown = requireElement<HTMLElement>(root, ".hud-ability-cooldown");

  let destroyed = false;
  let abilityHandler: (() => void) | undefined;
  const activateAbility = (): void => {
    if (!abilityButton.disabled) abilityHandler?.();
  };
  abilityButton.addEventListener("click", activateAbility);

  const updateResources = (resources: HudResources): void => {
    const population =
      resources.population === undefined
        ? "—"
        : typeof resources.population === "number"
        ? String(resources.population)
        : `${resources.population.used}/${resources.population.capacity}`;
    const values: Record<string, string> = {
      wood: Math.max(0, Math.floor(resources.wood)).toLocaleString(),
      food: Math.max(0, Math.floor(resources.food)).toLocaleString(),
      stone: Math.max(0, Math.floor(resources.stone)).toLocaleString(),
      population,
    };
    const labels: Record<string, string> = {
      wood: "木材",
      food: "食物",
      stone: "石料",
      population: "人口",
    };
    Object.entries(values).forEach(([key, value]) => {
      const valueNode = resourceValues.get(key);
      const output = resourceOutputs.get(key);
      if (valueNode && output) {
        valueNode.textContent = value;
        output.setAttribute("aria-label", `${labels[key]} ${value}`);
      }
    });
  };

  const updateSelection = (selection: HudSelection | null): void => {
    selectionDetails.replaceChildren();
    if (!selection) {
      selectionName.textContent = "尚未選取";
      selectionKind.textContent = "框選單位或建築以查看資訊";
      return;
    }

    selectionName.textContent = selection.name;
    selectionKind.textContent = selection.kind ?? "戰場目標";
    const rows: Array<[string, string | undefined]> = [
      ["陣營", selection.owner],
      [
        "耐久",
        selection.hitPoints === undefined
          ? undefined
          : selection.maxHitPoints === undefined
            ? String(selection.hitPoints)
            : `${selection.hitPoints} / ${selection.maxHitPoints}`,
      ],
      ["攻擊", selection.attack === undefined ? undefined : String(selection.attack)],
      [
        "防護",
        selection.armor === undefined
          ? selection.armorClass
          : `${selection.armor}${selection.armorClass ? ` · ${selection.armorClass}` : ""}`,
      ],
      ["傷害", selection.damageType],
      ["射程", selection.range === undefined ? undefined : String(selection.range)],
      ["技能", selection.ability],
      ["被動", selection.passive],
      ["克制", selection.counterHint],
      ["狀態", selection.detail],
    ];
    rows.forEach(([term, value]) => {
      if (!value) return;
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      selectionDetails.append(dt, dd);
    });
  };

  const setAbility = (
    ability: HudAbility | null,
    onActivate?: () => void,
  ): void => {
    abilityHandler = onActivate;
    if (!ability) {
      abilityButton.hidden = true;
      abilityButton.disabled = true;
      abilityButton.removeAttribute("aria-label");
      return;
    }
    const remaining = Math.max(0, ability.cooldownRemaining ?? 0);
    const total = Math.max(0, ability.cooldownTotal ?? 0);
    const coolingDown = remaining > 0;
    abilityButton.hidden = false;
    abilityButton.disabled = Boolean(ability.disabled) || coolingDown;
    abilityKey.textContent = ability.hotkey ?? "Q";
    abilityName.textContent = ability.name;
    abilityDetail.textContent = ability.description;
    abilityCooldown.textContent = coolingDown ? `${remaining.toFixed(1)}s` : "READY";
    abilityButton.style.setProperty(
      "--ability-ready",
      total > 0 ? String(1 - Math.min(1, remaining / total)) : "1",
    );
    abilityButton.setAttribute(
      "aria-label",
      coolingDown
        ? `${ability.name}，冷卻剩餘 ${remaining.toFixed(1)} 秒`
        : `${ability.name}，${ability.description}`,
    );
  };

  const setStatus = (
    message: string,
    tone: HudStatusTone = "neutral",
  ): void => {
    const safeTone: HudStatusTone = tone in STATUS_MARKS ? tone : "neutral";
    status.dataset.tone = safeTone === "success" ? "ready" : safeTone === "info" ? "neutral" : safeTone;
    statusMark.textContent = STATUS_MARKS[safeTone];
    statusCopy.textContent = message;
    status.setAttribute("aria-label", `${STATUS_MARKS[safeTone]} ${message}`);
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    abilityButton.removeEventListener("click", activateAbility);
    scene.events.off("shutdown", destroy);
    scene.events.off("destroy", destroy);
    root.remove();
  };

  scene.events.once("shutdown", destroy);
  scene.events.once("destroy", destroy);

  return { updateResources, updateSelection, setAbility, setStatus, destroy };
}
