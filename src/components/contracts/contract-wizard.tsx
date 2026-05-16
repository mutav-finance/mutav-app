"use client";

import * as React from "react";
import type { Id } from "@convex/_generated/dataModel";
import { useWorkspace } from "@/providers/workspace";
import { StepIndicator } from "@/components/contracts/step-indicator";
import { WizardStep1 } from "@/components/contracts/wizard-step1";
import { WizardStep2 } from "@/components/contracts/wizard-step2";
import { WizardStep3 } from "@/components/contracts/wizard-step3";
import {
  wizardReducer,
  INITIAL_WIZARD_DATA,
  type WizardData,
} from "@/lib/contracts/wizard";

export function ContractWizard() {
  const [state, dispatch] = React.useReducer(wizardReducer, {
    step: 1,
    data: INITIAL_WIZARD_DATA,
  });

  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id as Id<"agencies"> | undefined;

  const patch = React.useCallback((p: Partial<WizardData>) => {
    dispatch({ type: "PATCH", patch: p });
  }, []);

  if (!agencyId) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator current={state.step} total={3} />

      {state.step === 1 && (
        <WizardStep1
          data={state.data}
          onChange={patch}
          onNext={() => dispatch({ type: "GO_TO", step: 2 })}
        />
      )}

      {state.step === 2 && (
        <WizardStep2
          data={state.data}
          onChange={patch}
          onNext={() => dispatch({ type: "GO_TO", step: 3 })}
          onBack={() => dispatch({ type: "GO_TO", step: 1 })}
        />
      )}

      {state.step === 3 && (
        <WizardStep3
          data={state.data}
          agencyId={agencyId}
          onBack={() => dispatch({ type: "GO_TO", step: 2 })}
        />
      )}
    </div>
  );
}
