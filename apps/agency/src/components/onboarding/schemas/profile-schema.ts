import { z } from "zod";
import { isValidCPF, isValidCNPJ } from "@/lib/brazil";

// Error codes — the i18n layer in the component maps these to translated
// strings via `onboarding.profile.errors.<code>`. Mirrors the server-side
// pattern: schema returns codes, presentation maps to messages.
const ERROR = {
  AGENCY_TYPE_REQUIRED: "agencyType",
  NAME_REQUIRED: "name",
  EMAIL_INVALID: "email",
  PHONE_INVALID: "phone",
  CRECI_REQUIRED: "creci",
  CPF_INVALID: "cpf",
  CNPJ_INVALID: "cnpj",
  REPRESENTANTE_NAME_REQUIRED: "representanteName",
  REPRESENTANTE_CPF_INVALID: "representanteCpf",
} as const;

// Input shape — RHF works with this. Empty agencyType is the initial state.
const profileInputSchema = z.object({
  agencyType: z.enum(["", "autonomo", "empresa"]),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  creci: z.string(),
  cpf: z.string(),
  cnpj: z.string(),
  representanteName: z.string(),
  representanteCpf: z.string(),
});

export type ProfileFormInput = z.infer<typeof profileInputSchema>;

// Output shape — what handleSubmit receives. agencyType has been narrowed
// to one of the two real variants; superRefine guaranteed it at runtime.
type ProfileFormOutput = Omit<ProfileFormInput, "agencyType"> & {
  agencyType: "autonomo" | "empresa";
};

export const profileSchema = profileInputSchema
  .superRefine((data, ctx) => {
    if (!data.agencyType) {
      ctx.addIssue({ code: "custom", path: ["agencyType"], message: ERROR.AGENCY_TYPE_REQUIRED });
      // Variant-specific checks need an agency type; surface only the
      // top-level error and stop.
      return;
    }
    if (!data.name.trim()) {
      ctx.addIssue({ code: "custom", path: ["name"], message: ERROR.NAME_REQUIRED });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      ctx.addIssue({ code: "custom", path: ["email"], message: ERROR.EMAIL_INVALID });
    }
    if (data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: ERROR.PHONE_INVALID });
    }
    if (!data.creci.trim()) {
      ctx.addIssue({ code: "custom", path: ["creci"], message: ERROR.CRECI_REQUIRED });
    }

    if (data.agencyType === "autonomo") {
      if (!isValidCPF(data.cpf)) {
        ctx.addIssue({ code: "custom", path: ["cpf"], message: ERROR.CPF_INVALID });
      }
      return;
    }

    // empresa
    if (!isValidCNPJ(data.cnpj)) {
      ctx.addIssue({ code: "custom", path: ["cnpj"], message: ERROR.CNPJ_INVALID });
    }
    if (!data.representanteName.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["representanteName"],
        message: ERROR.REPRESENTANTE_NAME_REQUIRED,
      });
    }
    if (!isValidCPF(data.representanteCpf)) {
      ctx.addIssue({
        code: "custom",
        path: ["representanteCpf"],
        message: ERROR.REPRESENTANTE_CPF_INVALID,
      });
    }
  })
  // transform narrows agencyType from "" | "autonomo" | "empresa" to
  // "autonomo" | "empresa" — superRefine above rejects empty, so this
  // never runs when agencyType === "". The handler reads the narrowed type.
  .transform((data): ProfileFormOutput => {
    if (data.agencyType === "") {
      throw new Error("unreachable: superRefine rejects empty agencyType");
    }
    return { ...data, agencyType: data.agencyType };
  });

export type ProfileFormValues = z.output<typeof profileSchema>;

export const PROFILE_FORM_DEFAULTS: ProfileFormInput = {
  agencyType: "",
  name: "",
  email: "",
  phone: "",
  creci: "",
  cpf: "",
  cnpj: "",
  representanteName: "",
  representanteCpf: "",
};
