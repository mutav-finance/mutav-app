"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { StepIndicator } from "@mutav/ui/step-indicator";
import { useWorkspace } from "@/providers/workspace";
import { WizardStep1 } from "@/components/contracts/wizard-step1";
import { WizardStep2 } from "@/components/contracts/wizard-step2";
import { WizardStep3 } from "@/components/contracts/wizard-step3";
import { WizardStep4 } from "@/components/contracts/wizard-step4";
import { WizardStep5 } from "@/components/contracts/wizard-step5";
import { wizardReducer, INITIAL_WIZARD_DATA, type WizardData } from "@/lib/contracts/wizard";

const CONTRACT_WIZARD_STEPS = [1, 2, 3, 4, 5] as const;

export function ContractWizard() {
  const t = useTranslations("contractNew");
  const [state, dispatch] = React.useReducer(wizardReducer, {
    step: 1,
    data: INITIAL_WIZARD_DATA,
  });

  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const patch = React.useCallback((p: Partial<WizardData>) => {
    dispatch({ type: "PATCH", patch: p });
  }, []);

  if (!agencyId) {
    return null;
  }

  const stepLabels = CONTRACT_WIZARD_STEPS.map((n) => t(`steps.${n}`));

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator
        current={state.step}
        labels={stepLabels}
        progressLabel={t("stepLabel", { current: state.step, total: CONTRACT_WIZARD_STEPS.length })}
        doneSuffix=""
        currentSuffix=""
      />

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
          onChange={patch}
          onNext={() => dispatch({ type: "GO_TO", step: 4 })}
          onBack={() => dispatch({ type: "GO_TO", step: 2 })}
        />
      )}

      {state.step === 4 && (
        <WizardStep4
          data={state.data}
          agencyId={agencyId}
          onChange={patch}
          onComplete={(publicId) => dispatch({ type: "COMPLETE", publicId })}
          onBack={() => dispatch({ type: "GO_TO", step: 3 })}
        />
      )}

      {state.step === 5 && state.publicId && (
        <WizardStep5 publicId={state.publicId} onReset={() => dispatch({ type: "RESET" })} />
      )}
    </div>
  );
}
