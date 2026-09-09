"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { GUARANTEE_STATES, type GuaranteeState } from "@convex/guarantees/domain";
import { AgencyStateChart } from "@/components/guarantees/agency-state-chart";
import { GuaranteeLifecyclePipeline } from "@/components/guarantees/guarantee-lifecycle-pipeline";
import { GuaranteeListTable, type StateTab } from "@/components/guarantees/guarantee-list-table";
import { useWorkspace } from "@/providers/workspace";

function isGuaranteeState(tab: StateTab): tab is GuaranteeState {
  return GUARANTEE_STATES.some((state) => state === tab);
}

/**
 * The dashboard's guarantee book: where it sits, how it moved, and the rows.
 *
 * The three pieces are one component because they share one filter. The table's
 * tabs already own that state, so the pipeline drives the tabs rather than
 * growing a parallel mechanism — the state lifts to here, the lowest node above
 * both, and nothing else on the page has to know about it.
 */
export function AgencyGuaranteeBook() {
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const counts = useQuery(
    api.guarantees.useCases.getStatusCounts,
    agencyId ? { agencyId } : "skip",
  );

  const [stateTab, setStateTab] = React.useState<StateTab>("all");

  return (
    <>
      <div className="px-4 lg:px-6">
        <GuaranteeLifecyclePipeline
          counts={counts ?? null}
          selectedState={isGuaranteeState(stateTab) ? stateTab : null}
          onSelectState={(state) => setStateTab(state ?? "all")}
        />
      </div>
      <div className="px-4 lg:px-6">
        <AgencyStateChart />
      </div>
      <GuaranteeListTable
        defaultSort={[{ id: "urgency", desc: false }]}
        stateTab={stateTab}
        onStateTabChange={setStateTab}
      />
    </>
  );
}
