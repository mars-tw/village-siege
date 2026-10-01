import {
  LANDMARK_VICTORY_HOLD_TICKS,
  TIMED_CONTROL_START_TICK,
  TIMED_CONTROL_TARGET_TICKS,
  TOWN_CENTER_REBUILD_GRACE_TICKS,
  VILLAGE_ASSAULT_CONTROL_OBJECTIVE,
  type VictoryPolicy,
} from "@village-siege/shared";

export type BattleModeId = "siege" | "territory";

const MODE_POLICIES = {
  siege: {
    commandCenterConquest: { rebuildGraceTicks: TOWN_CENTER_REBUILD_GRACE_TICKS },
    elimination: true,
    landmark: null,
    timedControl: null,
  },
  territory: {
    commandCenterConquest: { rebuildGraceTicks: TOWN_CENTER_REBUILD_GRACE_TICKS },
    elimination: true,
    landmark: {
      buildingType: "copperLandmark",
      requiredCount: 1,
      holdTicks: LANDMARK_VICTORY_HOLD_TICKS,
    },
    timedControl: {
      point: { ...VILLAGE_ASSAULT_CONTROL_OBJECTIVE.point },
      radius: VILLAGE_ASSAULT_CONTROL_OBJECTIVE.radius,
      startsAtTick: TIMED_CONTROL_START_TICK,
      targetTicks: TIMED_CONTROL_TARGET_TICKS,
    },
  },
} as const satisfies Readonly<Record<BattleModeId, VictoryPolicy>>;

/** Returns a fresh policy so callers cannot mutate the menu presets. */
export function getBattleModePolicy(id: BattleModeId): VictoryPolicy {
  const policy = MODE_POLICIES[id];
  return {
    commandCenterConquest: policy.commandCenterConquest ? { ...policy.commandCenterConquest } : null,
    elimination: policy.elimination,
    landmark: policy.landmark ? { ...policy.landmark } : null,
    timedControl: policy.timedControl
      ? { ...policy.timedControl, point: { ...policy.timedControl.point } }
      : null,
  };
}

/**
 * Classifies a validated save policy without changing it. Custom and legacy
 * multi-route policies remain territory battles instead of being normalized.
 */
export function idFromPolicy(policy: VictoryPolicy): BattleModeId {
  return policy.commandCenterConquest !== null
    && policy.elimination
    && policy.landmark === null
    && policy.timedControl === null
    ? "siege"
    : "territory";
}
