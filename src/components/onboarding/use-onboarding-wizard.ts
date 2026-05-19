"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { isBankAccountType } from "@/components/onboarding/use-wizard-step-banking";
import type { ProfileFormValues } from "@/components/onboarding/schemas/profile-schema";

// ─── Public types ─────────────────────────────────────────────────────────────

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

export type WizardStepKind = "profile" | "documents" | "banking" | "review";

// ─── Internal: reducer + helpers ──────────────────────────────────────────────

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
  agencyId: AgencyId | null;
  data: OnboardingWizardData;
  submitState: SubmitState;
  errorCode: string | null;
};

type WizardAction =
  | { type: "PATCH"; patch: Partial<OnboardingWizardData> }
  | { type: "SAVE_PROFILE"; values: ProfileFormValues }
  | { type: "GO_TO"; step: number }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; agencyId?: AgencyId }
  | { type: "SUBMIT_DONE" }
  | { type: "SUBMIT_ERROR"; code: string };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "PATCH":
      return { ...state, data: { ...state.data, ...action.patch } };
    case "SAVE_PROFILE":
      // Step1 (RHF) hands the wizard a validated snapshot. Persisted so the
      // review screen can render it and so going back to step1 prefills.
      return {
        ...state,
        data: {
          ...state.data,
          agencyType: action.values.agencyType,
          name: action.values.name,
          email: action.values.email,
          phone: action.values.phone,
          creci: action.values.creci,
          cpf: action.values.agencyType === "autonomo" ? action.values.cpf : "",
          cnpj: action.values.agencyType === "empresa" ? action.values.cnpj : "",
          representanteName:
            action.values.agencyType === "empresa" ? action.values.representanteName : "",
          representanteCpf:
            action.values.agencyType === "empresa" ? action.values.representanteCpf : "",
        },
      };
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

function resolveStepKind(step: number, agencyType: string): WizardStepKind {
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

const WIZARD_ERROR_CODES = [
  "CNPJ_REQUIRED",
  "CPF_REQUIRED",
  "CPF_INVALID",
  "CNPJ_INVALID",
  "REPRESENTANTE_NAME_REQUIRED",
  "REPRESENTANTE_CPF_REQUIRED",
  "REPRESENTANTE_CPF_INVALID",
  "ALREADY_REGISTERED",
  "AGENCY_TYPE_CONFLICT",
  "INCOMPLETE_PROFILE",
] as const;

type WizardErrorCode = (typeof WIZARD_ERROR_CODES)[number];

function isWizardErrorCode(code: string): code is WizardErrorCode {
  return (WIZARD_ERROR_CODES as readonly string[]).includes(code);
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

// ─── View model hook ──────────────────────────────────────────────────────────

export function useOnboardingWizard({ initialType }: { initialType?: "autonomo" | "empresa" }) {
  const t = useTranslations("onboarding.wizard");

  const [state, dispatch] = React.useReducer(wizardReducer, initialType, buildInitialState);

  // Strip ?type= from the URL once mounted — refresh without the param triggers
  // the server redirect in wizard/page.tsx that sends the user back to /onboarding.
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

  const handleStep1Submit = React.useCallback(
    async (values: ProfileFormValues) => {
      // Schema's superRefine rejects empty agencyType; if we got here it's
      // narrowed by validation, not by TS.
      if (values.agencyType === "") {
        dispatch({ type: "SUBMIT_ERROR", code: "INCOMPLETE_PROFILE" });
        return;
      }
      const agencyType = values.agencyType;
      dispatch({ type: "SAVE_PROFILE", values });
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await startOnboarding({
          agencyType,
          name: values.name,
          email: values.email,
          phone: values.phone,
          creci: values.creci,
          cpf: agencyType === "autonomo" ? values.cpf : undefined,
          cnpj: agencyType === "empresa" ? values.cnpj : undefined,
          representanteName: agencyType === "empresa" ? values.representanteName : undefined,
          representanteCpf: agencyType === "empresa" ? values.representanteCpf : undefined,
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
    [startOnboarding],
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
          branch: state.data.bankBranch,
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

  const handleDocumentsNext = React.useCallback(() => {
    dispatch({ type: "SUBMIT_SUCCESS" });
  }, []);

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

  const handleBack = React.useCallback(() => {
    dispatch({ type: "GO_TO", step: state.step - 1 });
  }, [state.step]);

  const handleGoTo = React.useCallback((step: number) => {
    dispatch({ type: "GO_TO", step });
  }, []);

  const errorMessage = state.errorCode
    ? isWizardErrorCode(state.errorCode)
      ? t(`errors.${state.errorCode}`)
      : t("errors.unknown")
    : null;

  const stepKind = resolveStepKind(state.step, state.data.agencyType);

  return {
    data: state.data,
    currentStep: state.step,
    stepKind,
    stepLabels,
    isSubmitting: state.submitState === "submitting",
    isSubmitted: state.submitState === "submitted",
    agencyId: state.agencyId,
    errorCode: state.errorCode,
    errorMessage,
    patch,
    handleStep1Submit,
    handleBankingNext,
    handleDocumentsNext,
    handleSubmit,
    handleBack,
    handleGoTo,
  };
}
