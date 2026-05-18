"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { DEV_USER_PUBLIC_ID } from "@/providers/workspace";
import { WizardStepIndicator } from "@/components/onboarding/wizard-step-indicator";
import { WizardStep1 } from "@/components/onboarding/wizard-step1";
import { WizardStepBanking, isBankAccountType } from "@/components/onboarding/wizard-step-banking";
import { WizardStepDocuments } from "@/components/onboarding/wizard-step-documents";
import { WizardStepReview } from "@/components/onboarding/wizard-step-review";

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type OnboardingWizardData = {
  agencyType: "autonomo" | "empresa" | "";
  name: string;
  email: string;
  phone: string;
  creci: string;
  cpf: string;
  cnpj: string;
  representanteName: string;
  representanteCpf: string;
  bankName: string;
  bankBranch: string;
  bankAccount: string;
  bankAccountType: "corrente" | "poupanca" | "";
  bankPixKey: string;
};

// ─── Estado do wizard (reducer) ───────────────────────────────────────────────

const INITIAL_DATA: OnboardingWizardData = {
  agencyType: "",
  name: "",
  email: "",
  phone: "",
  creci: "",
  cpf: "",
  cnpj: "",
  representanteName: "",
  representanteCpf: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "",
  bankPixKey: "",
};

type SubmitState = "idle" | "submitting" | "submitted";

type WizardState = {
  step: number;
  agencyId: Id<"agencies"> | null;
  data: OnboardingWizardData;
  submitState: SubmitState;
  errorCode: string | null;
};

type WizardAction =
  | { type: "PATCH"; patch: Partial<OnboardingWizardData> }
  | { type: "GO_TO"; step: number }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; agencyId?: Id<"agencies"> }
  | { type: "SUBMIT_DONE" }
  | { type: "SUBMIT_ERROR"; code: string };

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "PATCH":
      return { ...state, data: { ...state.data, ...action.patch } };
    case "GO_TO":
      return { ...state, step: action.step };
    case "SUBMIT_START":
      return { ...state, submitState: "submitting", errorCode: null };
    case "SUBMIT_SUCCESS":
      return {
        ...state,
        submitState: "idle",
        agencyId: action.agencyId ?? state.agencyId,
        step: state.step + 1,
      };
    case "SUBMIT_DONE":
      return { ...state, submitState: "submitted", errorCode: null };
    case "SUBMIT_ERROR":
      return { ...state, submitState: "idle", errorCode: action.code };
  }
}

// ─── Helpers do wizard ────────────────────────────────────────────────────────

type StepKind = "profile" | "documents" | "banking" | "review";

function resolveStepKind(step: number, agencyType: string): StepKind {
  if (step === 1) return "profile";
  if (agencyType === "autonomo") {
    if (step === 2) return "banking";
    if (step === 3) return "review";
  }
  if (agencyType === "empresa") {
    if (step === 2) return "documents";
    if (step === 3) return "banking";
    if (step === 4) return "review";
  }
  return "profile";
}

type WizardErrorCode =
  | "CNPJ_REQUIRED"
  | "CPF_REQUIRED"
  | "CPF_INVALID"
  | "CNPJ_INVALID"
  | "REPRESENTANTE_NAME_REQUIRED"
  | "REPRESENTANTE_CPF_REQUIRED"
  | "REPRESENTANTE_CPF_INVALID"
  | "ALREADY_REGISTERED";

function isWizardErrorCode(code: string): code is WizardErrorCode {
  return (
    code === "CNPJ_REQUIRED" ||
    code === "CPF_REQUIRED" ||
    code === "CPF_INVALID" ||
    code === "CNPJ_INVALID" ||
    code === "REPRESENTANTE_NAME_REQUIRED" ||
    code === "REPRESENTANTE_CPF_REQUIRED" ||
    code === "REPRESENTANTE_CPF_INVALID" ||
    code === "ALREADY_REGISTERED"
  );
}

function buildInitialState(initialType: "autonomo" | "empresa" | undefined): WizardState {
  return {
    step: 1,
    agencyId: null,
    data: { ...INITIAL_DATA, agencyType: initialType ?? "" },
    submitState: "idle",
    errorCode: null,
  };
}

// ─── Componente público: busca userId e controla loading/erro ─────────────────

export function OnboardingWizard({ initialType }: { initialType?: "autonomo" | "empresa" }) {
  const t = useTranslations("onboarding.wizard");

  // TODO(auth): swap para identidade da sessão real.
  const devUser = useQuery(api.users.useCases.getByPublicId, { publicId: DEV_USER_PUBLIC_ID });

  if (devUser === undefined) {
    return <div className="text-text-3 py-8 text-center font-mono text-sm">{t("loading")}</div>;
  }

  if (devUser === null) {
    return (
      <div className="text-error py-8 text-center font-mono text-sm">{t("errors.unknown")}</div>
    );
  }

  return <OnboardingWizardInner devUserId={devUser._id} initialType={initialType} />;
}

// ─── Componente interno: máquina de estados + UI ──────────────────────────────

function OnboardingWizardInner({
  devUserId,
  initialType,
}: {
  devUserId: Id<"users">;
  initialType?: "autonomo" | "empresa";
}) {
  const t = useTranslations("onboarding.wizard");

  const [state, dispatch] = React.useReducer(wizardReducer, initialType, buildInitialState);

  // Remove ?type= da URL após montar — refresh sem o param aciona o server redirect
  // em wizard/page.tsx, que envia o usuário de volta a /onboarding.
  React.useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const startOnboarding = useMutation(api.agencies.useCases.startOnboarding);
  const saveBankingInfo = useMutation(api.agencies.useCases.saveBankingInfo);
  const submitOnboarding = useMutation(api.agencies.useCases.submitOnboarding);

  const patch = React.useCallback((p: Partial<OnboardingWizardData>) => {
    dispatch({ type: "PATCH", patch: p });
  }, []);

  const stepLabels = React.useMemo(() => {
    const perfil = t("steps.perfil");
    const documentos = t("steps.documentos");
    const contaBancaria = t("steps.contaBancaria");
    const revisao = t("steps.revisao");
    if (state.data.agencyType === "autonomo") return [perfil, contaBancaria, revisao];
    if (state.data.agencyType === "empresa") return [perfil, documentos, contaBancaria, revisao];
    return [perfil, contaBancaria, revisao];
  }, [state.data.agencyType, t]);

  const handleStep1Next = React.useCallback(
    async (agencyType: "autonomo" | "empresa") => {
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await startOnboarding({
          userId: devUserId,
          agencyType,
          name: state.data.name,
          email: state.data.email,
          phone: state.data.phone,
          creci: state.data.creci,
          cpf: agencyType === "autonomo" ? state.data.cpf : undefined,
          cnpj: agencyType === "empresa" ? state.data.cnpj : undefined,
          representanteName: agencyType === "empresa" ? state.data.representanteName : undefined,
          representanteCpf: agencyType === "empresa" ? state.data.representanteCpf : undefined,
        });
        if (!result.success) {
          dispatch({ type: "SUBMIT_ERROR", code: result.error.code });
          return;
        }
        dispatch({ type: "SUBMIT_SUCCESS", agencyId: result.data.agencyId });
      } catch {
        dispatch({ type: "SUBMIT_ERROR", code: "NETWORK_ERROR" });
      }
    },
    [devUserId, startOnboarding, state.data],
  );

  const handleBankingNext = React.useCallback(async () => {
    if (!state.agencyId || !isBankAccountType(state.data.bankAccountType)) {
      dispatch({ type: "SUBMIT_ERROR", code: "INTERNAL_ERROR" });
      return;
    }
    dispatch({ type: "SUBMIT_START" });
    try {
      const result = await saveBankingInfo({
        agencyId: state.agencyId,
        bankingInfo: {
          bank: state.data.bankName,
          agency: state.data.bankBranch,
          account: state.data.bankAccount,
          accountType: state.data.bankAccountType,
          pixKey: state.data.bankPixKey || undefined,
        },
      });
      if (!result.success) {
        dispatch({ type: "SUBMIT_ERROR", code: result.error.code });
        return;
      }
      dispatch({ type: "SUBMIT_SUCCESS" });
    } catch {
      dispatch({ type: "SUBMIT_ERROR", code: "NETWORK_ERROR" });
    }
  }, [state.agencyId, state.data, saveBankingInfo]);

  const handleDocumentsNext = () => {
    dispatch({ type: "SUBMIT_SUCCESS" });
  };

  const handleSubmit = React.useCallback(
    async (opts: { consentMarketing: boolean }) => {
      if (!state.agencyId) {
        dispatch({ type: "SUBMIT_ERROR", code: "INTERNAL_ERROR" });
        return;
      }
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await submitOnboarding({
          agencyId: state.agencyId,
          consentMarketing: opts.consentMarketing,
        });
        if (!result.success) {
          dispatch({ type: "SUBMIT_ERROR", code: result.error.code });
          return;
        }
        dispatch({ type: "SUBMIT_DONE" });
      } catch {
        dispatch({ type: "SUBMIT_ERROR", code: "NETWORK_ERROR" });
      }
    },
    [state.agencyId, submitOnboarding],
  );

  if (state.submitState === "submitted") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-text text-lg font-medium">{t("submitted.title")}</p>
        <p className="text-text-2 max-w-sm text-sm">{t("submitted.subtitle")}</p>
        <p className="text-text-3 text-xs">{t("submitted.detail", { email: state.data.email })}</p>
      </div>
    );
  }

  const errorMessage = state.errorCode
    ? isWizardErrorCode(state.errorCode)
      ? t(`errors.${state.errorCode}`)
      : t("errors.unknown")
    : null;

  const stepKind = resolveStepKind(state.step, state.data.agencyType);

  return (
    <div className="flex flex-col gap-8">
      <WizardStepIndicator
        current={state.step}
        labels={stepLabels}
        progressLabel={t("progressLabel")}
        doneSuffix={t("stepDoneSuffix")}
        currentSuffix={t("stepCurrentSuffix")}
      />

      {errorMessage && (
        <p
          role="alert"
          className="border-error/30 bg-error/5 text-error border-l-2 px-4 py-2 text-sm"
        >
          {errorMessage}
        </p>
      )}

      {stepKind === "profile" && (
        <WizardStep1
          data={state.data}
          onChange={patch}
          onNext={handleStep1Next}
          isSubmitting={state.submitState === "submitting"}
        />
      )}

      {stepKind === "banking" && (
        <WizardStepBanking
          data={state.data}
          onChange={patch}
          onNext={handleBankingNext}
          onBack={() => dispatch({ type: "GO_TO", step: state.step - 1 })}
          isSubmitting={state.submitState === "submitting"}
        />
      )}

      {stepKind === "documents" &&
        (state.agencyId ? (
          <WizardStepDocuments
            agencyId={state.agencyId}
            onNext={handleDocumentsNext}
            onBack={() => dispatch({ type: "GO_TO", step: state.step - 1 })}
          />
        ) : (
          <p role="alert" className="text-error text-sm">
            {t("errors.unknown")}
          </p>
        ))}

      {stepKind === "review" && (
        <WizardStepReview
          data={state.data}
          onSubmit={handleSubmit}
          onBack={() => dispatch({ type: "GO_TO", step: state.step - 1 })}
          onGoTo={(step) => dispatch({ type: "GO_TO", step })}
          isSubmitting={state.submitState === "submitting"}
        />
      )}
    </div>
  );
}
