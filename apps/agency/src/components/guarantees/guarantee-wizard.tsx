"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { StepIndicator } from "@mutav/ui/step-indicator";
import { useWorkspace } from "@/providers/workspace";
import { WizardStep1 } from "@/components/guarantees/wizard-step1";
import { WizardStep2 } from "@/components/guarantees/wizard-step2";
import { WizardStep3 } from "@/components/guarantees/wizard-step3";
import { WizardStep4 } from "@/components/guarantees/wizard-step4";
import { WizardStep5 } from "@/components/guarantees/wizard-step5";
import { wizardReducer, INITIAL_WIZARD_DATA, type DraftWizardData } from "@/lib/guarantees/wizard";

const GUARANTEE_WIZARD_STEPS = [1, 2, 3, 4, 5] as const;

export function GuaranteeWizard() {
  const t = useTranslations("guaranteeNew");
  const [state, dispatch] = React.useReducer(wizardReducer, {
    step: 1,
    data: INITIAL_WIZARD_DATA,
  });

  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  // The product the server will price against. Steps 2 and 4 quote from its
  // terms so the broker's preview and the stored snapshot come from the same
  // parameters; until it loads they show no figures rather than stale ones.
  const product = useQuery(api.products.useCases.getDefaultPublic, {});

  const patch = React.useCallback((p: Partial<DraftWizardData>) => {
    dispatch({ type: "PATCH", patch: p });
  }, []);

  const stepLabels = React.useMemo(() => GUARANTEE_WIZARD_STEPS.map((n) => t(`steps.${n}`)), [t]);

  if (!agencyId) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator
        current={state.step}
        labels={stepLabels}
        progressLabel={t("stepLabel", {
          current: state.step,
          total: GUARANTEE_WIZARD_STEPS.length,
        })}
        doneSuffix=""
        currentSuffix=""
      />

      {state.step === 1 && (
        <WizardStep1
          data={state.data}
          agencyId={agencyId}
          onChange={patch}
          onNext={() => dispatch({ type: "GO_TO", step: 2 })}
        />
      )}

      {state.step === 2 && (
        <WizardStep2
          data={state.data}
          product={product ?? null}
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
          product={product ?? null}
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
