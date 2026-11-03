"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import {
  currentCommissionMonth,
  filterCommissionRows,
  shiftPeriodMonth,
  summarizeCommission,
} from "./view-model";

export type CommissionRow = FunctionReturnType<
  typeof api.guarantees.useCases.listForCommissionByMonth
>[number];

export function useCommissionPage() {
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;
  const [currentMonth] = React.useState(() => currentCommissionMonth(new Date()));
  const [periodMonth, setPeriodMonth] = React.useState(currentMonth);
  const [search, setSearch] = React.useState("");

  const rows = useQuery(
    api.guarantees.useCases.listForCommissionByMonth,
    agencyId ? { agencyId, periodMonth } : "skip",
  );

  const isLoading = rows === undefined;
  const summary = summarizeCommission(rows ?? []);
  const filteredRows = filterCommissionRows(rows ?? [], search);

  return {
    periodMonth,
    isCurrentMonth: periodMonth >= currentMonth,
    goToPreviousMonth: () => setPeriodMonth((month) => shiftPeriodMonth(month, -1)),
    goToNextMonth: () => setPeriodMonth((month) => shiftPeriodMonth(month, 1)),
    search,
    setSearch,
    isLoading,
    totalCommissionCents: summary.totalCommissionCents,
    guaranteeCount: summary.guaranteeCount,
    filteredRows,
  };
}
