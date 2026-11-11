import type { StatusTagTone } from "@mutav/ui/status-tag";
import { COVERAGE_STATE, type CoverageState } from "./reserve-view-model";

export const COVERAGE_TONE: Record<CoverageState, StatusTagTone> = {
  [COVERAGE_STATE.NO_REQUIREMENT]: "neutral",
  [COVERAGE_STATE.OK]: "positive",
  [COVERAGE_STATE.ATTENTION]: "warning",
  [COVERAGE_STATE.BELOW_TARGET]: "critical",
};
