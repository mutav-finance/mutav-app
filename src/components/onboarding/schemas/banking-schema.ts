import { z } from "zod";

// Same code-not-message pattern as profile-schema.ts: validators emit
// error codes that the component maps to onboarding.wizard.banking.errors.<code>.
const ERROR = {
  BANK_REQUIRED: "bank",
  BRANCH_REQUIRED: "branch",
  ACCOUNT_REQUIRED: "account",
  ACCOUNT_TYPE_REQUIRED: "accountType",
} as const;

export const BANK_ACCOUNT_TYPE = ["corrente", "poupanca"] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPE)[number];

// Empty string lives in the input shape (initial state) — schema-level
// refine reports the missing case but doesn't narrow the output type.
// The handler narrows at runtime, matching the profile-schema pattern.
export const bankingSchema = z
  .object({
    bankName: z.string().trim().min(1, ERROR.BANK_REQUIRED),
    bankBranch: z.string().trim().min(1, ERROR.BRANCH_REQUIRED),
    bankAccount: z.string().trim().min(1, ERROR.ACCOUNT_REQUIRED),
    bankAccountType: z.enum(["", ...BANK_ACCOUNT_TYPE]),
    bankPixKey: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.bankAccountType === "") {
      ctx.addIssue({
        code: "custom",
        path: ["bankAccountType"],
        message: ERROR.ACCOUNT_TYPE_REQUIRED,
      });
    }
  });

export type BankingFormValues = z.infer<typeof bankingSchema>;

export const BANKING_FORM_DEFAULTS: BankingFormValues = {
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "",
  bankPixKey: "",
};
