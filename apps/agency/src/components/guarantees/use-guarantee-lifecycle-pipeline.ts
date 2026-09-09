"use client";

import { useTranslations } from "next-intl";
import { GUARANTEE_STATE, type GuaranteeState } from "@convex/guarantees/domain";
import { GUARANTEE_STATE_SWATCH_COLOR } from "@/components/guarantees/state-chart-palette";
import type { GuaranteeStateCounts } from "@/lib/guarantees/state-chart";

/**
 * The living lifecycle, in the order a guarantee walks it. Every consecutive
 * pair is a legal edge in `ALLOWED_TRANSITIONS`, and the test file holds this
 * order to the machine so the picture cannot drift from the guard that
 * enforces it.
 */
export const GUARANTEE_SPINE_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.DRAFTED,
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
];

/**
 * Exits, not steps. `in_eviction` is a one-way street to `closed` and `closed`
 * is terminal, so neither continues the spine — they leave it, and the layout
 * says so.
 */
export const GUARANTEE_EXIT_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.IN_EVICTION,
  GUARANTEE_STATE.CLOSED,
];

/** The three states a tenant can cure from, all of them back to `active`. */
export const GUARANTEE_CURE_ORIGIN_STATES: readonly GuaranteeState[] = [
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
];

export type LifecycleNode = {
  state: GuaranteeState;
  count: number;
  /** Nothing sits here — the node recedes so the occupied states carry the story. */
  isEmpty: boolean;
  isSelected: boolean;
  accentColor: string;
  select: () => void;
};

export type LifecyclePipeline = {
  spine: LifecycleNode[];
  exits: LifecycleNode[];
};

type LifecyclePipelineArgs = {
  counts: GuaranteeStateCounts | null | undefined;
  selectedState: GuaranteeState | null;
  onSelectState: (state: GuaranteeState | null) => void;
};

export function buildLifecyclePipeline({
  counts,
  selectedState,
  onSelectState,
}: LifecyclePipelineArgs): LifecyclePipeline | null {
  if (counts === null || counts === undefined) return null;

  const toNode = (state: GuaranteeState): LifecycleNode => {
    const isSelected = selectedState === state;
    return {
      state,
      count: counts[state],
      isEmpty: counts[state] === 0,
      isSelected,
      accentColor: GUARANTEE_STATE_SWATCH_COLOR[state],
      // The node that set the filter is the one a reader goes back to, so
      // selecting it again clears it rather than being a no-op.
      select: () => onSelectState(isSelected ? null : state),
    };
  };

  return {
    spine: GUARANTEE_SPINE_STATES.map(toNode),
    exits: GUARANTEE_EXIT_STATES.map(toNode),
  };
}

export function useGuaranteeLifecyclePipeline({
  counts,
  selectedState,
  onSelectState,
}: LifecyclePipelineArgs) {
  const t = useTranslations("lifecycle");
  const tState = useTranslations("guaranteeDetails.state");

  const pipeline = buildLifecyclePipeline({ counts, selectedState, onSelectState });

  return {
    spine: pipeline?.spine ?? null,
    exits: pipeline?.exits ?? null,
    isLoading: pipeline === null,
    title: t("title"),
    description: t("description"),
    spineLabel: t("spineLabel"),
    exitsLabel: t("exitsLabel"),
    cureLabel: t("cureReturn", { state: tState(GUARANTEE_STATE.ACTIVE) }),
    stateLabel: (state: GuaranteeState) => tState(state),
    nodeAriaLabel: (node: LifecycleNode) =>
      t("nodeAriaLabel", { state: tState(node.state), count: node.count }),
  };
}
