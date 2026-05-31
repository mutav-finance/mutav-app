"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import {
  BANKING_FORM_DEFAULTS,
  type BankingFormInput,
  type BankingFormValues,
} from "@/components/onboarding/schemas/banking-schema";
import {
  PROFILE_FORM_DEFAULTS,
  type ProfileFormInput,
  type ProfileFormValues,
} from "@/components/onboarding/schemas/profile-schema";
import type { ReviewFormValues } from "@/components/onboarding/schemas/review-schema";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Accumulated form snapshot across the flow's steps. Derived from the
 * profile + banking schema input types — single source of truth. Each
 * step's RHF form is the live state; this snapshot is what the reducer
 * captures on `SAVE_*` so the review screen and back-navigation prefill
 * can read across steps.
 */
export type OnboardingSnapshot = ProfileFormInput & BankingFormInput;

export type OnboardingStep = "profile" | "documents" | "banking" | "review";

// ─── Internal: reducer + helpers ──────────────────────────────────────────────

const INITIAL_SNAPSHOT: OnboardingSnapshot = {
  ...PROFILE_FORM_DEFAULTS,
  ...BANKING_FORM_DEFAULTS,
};

type SubmitState = "idle" | "submitting" | "submitted";

type OnboardingState = {
  step: number;
  agencyId: AgencyId | null;
  snapshot: OnboardingSnapshot;
  submitState: SubmitState;
  errorCode: string | null;
};

type OnboardingAction =
  | { type: "SAVE_PROFILE"; values: ProfileFormValues }
  | { type: "SAVE_BANKING"; values: BankingFormValues }
  | { type: "GO_TO"; step: number }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; agencyId?: AgencyId }
  | { type: "SUBMIT_DONE" }
  | { type: "SUBMIT_ERROR"; code: string };

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  switch (action.type) {
    case "SAVE_PROFILE":
      // Step1 (RHF) hands the flow a validated snapshot. Persisted so the
      // review screen can render it and so going back to step1 prefills.
      // Clear the opposite-variant identity fields on type switch.
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
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
    case "SAVE_BANKING":
      return { ...state, snapshot: { ...state.snapshot, ...action.values } };
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

function resolveStepKind(step: number, agencyType: string): OnboardingStep {
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

// Server + client error codes recognised by the flow banner. Keep in
// sync with `onboarding.errors.<CODE>` in messages/{pt-BR,en}.json
// — the i18n parity grep in scripts/regression-greps.sh enforces both
// locales stay aligned, but neither check verifies the union against
// what Convex actually returns. When a new code is added on the server,
// add it here AND in both locale files.
const ONBOARDING_ERROR_CODES = [
  // Profile-step server codes (convex/agencies/useCases.ts → startOnboarding)
  "AGENCY_TYPE_REQUIRED",
  "AGENCY_TYPE_CONFLICT",
  "CPF_REQUIRED",
  "CPF_INVALID",
  "CNPJ_REQUIRED",
  "CNPJ_INVALID",
  "REPRESENTANTE_NAME_REQUIRED",
  "REPRESENTANTE_CPF_REQUIRED",
  "REPRESENTANTE_CPF_INVALID",
  "ALREADY_REGISTERED",
  "INCOMPLETE_PROFILE",
  // Cross-step server codes (saveBankingInfo, submitOnboarding, saveDocument)
  "BANKING_INFO_REQUIRED",
  "MISSING_DOCUMENTS",
  "NOT_IN_PROGRESS",
  "ONBOARDING_NOT_EDITABLE",
  "NOT_FOUND",
  // Client-side codes emitted from handler try/catch blocks
  "NETWORK_ERROR",
  "INTERNAL_ERROR",
] as const;

type OnboardingErrorCode = (typeof ONBOARDING_ERROR_CODES)[number];

function isOnboardingErrorCode(code: string): code is OnboardingErrorCode {
  return (ONBOARDING_ERROR_CODES as readonly string[]).includes(code);
}

function buildInitialState(initialType: "autonomo" | "empresa" | undefined): OnboardingState {
  return {
    step: 1,
    agencyId: null,
    snapshot: { ...INITIAL_SNAPSHOT, agencyType: initialType ?? "" },
    submitState: "idle",
    errorCode: null,
  };
}

// ─── View model hook ──────────────────────────────────────────────────────────

export function useOnboardingFlow({ initialType }: { initialType?: "autonomo" | "empresa" }) {
  const t = useTranslations("onboarding");

  const [state, dispatch] = React.useReducer(onboardingReducer, initialType, buildInitialState);

  // Strip ?type= from the URL once mounted — refresh without the param triggers
  // the server redirect in flow/page.tsx that sends the user back to /onboarding.
  React.useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const startOnboarding = useMutation(api.agencies.useCases.startOnboarding);
  const saveBankingInfo = useMutation(api.agencies.useCases.saveBankingInfo);
  const submitOnboarding = useMutation(api.agencies.useCases.submitOnboarding);

  const stepLabels = React.useMemo(() => {
    const perfil = t("steps.perfil");
    const documentos = t("steps.documentos");
    const contaBancaria = t("steps.contaBancaria");
    const revisao = t("steps.revisao");
    if (state.snapshot.agencyType === "autonomo") return [perfil, contaBancaria, revisao];
    if (state.snapshot.agencyType === "empresa")
      return [perfil, documentos, contaBancaria, revisao];
    return [perfil, contaBancaria, revisao];
  }, [state.snapshot.agencyType, t]);

  // ─── Note on step shapes ────────────────────────────────────────────────────
  // Steps 1 (profile), 3 (banking), and 4 (review) are RHF forms — they own
  // their field state and call onSubmit(values) on completion. The flow
  // snapshots into state.snapshot via SAVE_PROFILE / SAVE_BANKING so the
  // review screen and back-navigation prefill can read across steps.
  //
  // Step 2 (documents) is intentionally different: it's an uploads flow,
  // not a form. Server-side state (storageId) is the truth; the step calls
  // onNext() on click after every required upload lands. No SAVE_* action.

  const handleStep1Submit = React.useCallback(
    async (values: ProfileFormValues) => {
      dispatch({ type: "SAVE_PROFILE", values });
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await startOnboarding({
          agencyType: values.agencyType,
          name: values.name,
          email: values.email,
          phone: values.phone,
          creci: values.creci,
          cpf: values.agencyType === "autonomo" ? values.cpf : undefined,
          cnpj: values.agencyType === "empresa" ? values.cnpj : undefined,
          representanteName: values.agencyType === "empresa" ? values.representanteName : undefined,
          representanteCpf: values.agencyType === "empresa" ? values.representanteCpf : undefined,
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

  const handleBankingSubmit = React.useCallback(
    async (values: BankingFormValues) => {
      if (!state.agencyId) {
        dispatch({ type: "SUBMIT_ERROR", code: "INTERNAL_ERROR" });
        return;
      }
      dispatch({ type: "SAVE_BANKING", values });
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await saveBankingInfo({
          agencyId: state.agencyId,
          bankingInfo: {
            bank: values.bankName,
            branch: values.bankBranch,
            account: values.bankAccount,
            accountType: values.bankAccountType,
            pixKey: values.bankPixKey || undefined,
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
    },
    [state.agencyId, saveBankingInfo],
  );

  const handleDocumentsNext = React.useCallback(() => {
    dispatch({ type: "SUBMIT_SUCCESS" });
  }, []);

  const handleReviewSubmit = React.useCallback(
    async (values: ReviewFormValues) => {
      if (!state.agencyId) {
        dispatch({ type: "SUBMIT_ERROR", code: "INTERNAL_ERROR" });
        return;
      }
      dispatch({ type: "SUBMIT_START" });
      try {
        const result = await submitOnboarding({
          agencyId: state.agencyId,
          consentMarketing: values.consentMarketing,
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
    ? isOnboardingErrorCode(state.errorCode)
      ? t(`errors.${state.errorCode}`)
      : t("errors.unknown")
    : null;

  const stepKind = resolveStepKind(state.step, state.snapshot.agencyType);

  return {
    snapshot: state.snapshot,
    currentStep: state.step,
    stepKind,
    stepLabels,
    isSubmitting: state.submitState === "submitting",
    isSubmitted: state.submitState === "submitted",
    agencyId: state.agencyId,
    errorCode: state.errorCode,
    errorMessage,
    handleStep1Submit,
    handleBankingSubmit,
    handleDocumentsNext,
    handleReviewSubmit,
    handleBack,
    handleGoTo,
  };
}
