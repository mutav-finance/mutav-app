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

const bankingInputSchema = z.object({
  bankName: z.string(),
  bankBranch: z.string(),
  bankAccount: z.string(),
  bankAccountType: z.enum(["", ...BANK_ACCOUNT_TYPE]),
  bankPixKey: z.string(),
});

export type BankingFormInput = z.infer<typeof bankingInputSchema>;

type BankingFormOutput = Omit<BankingFormInput, "bankAccountType"> & {
  bankAccountType: BankAccountType;
};

export const bankingSchema = bankingInputSchema
  .superRefine((data, ctx) => {
    if (!data.bankName.trim()) {
      ctx.addIssue({ code: "custom", path: ["bankName"], message: ERROR.BANK_REQUIRED });
    }
    if (!data.bankBranch.trim()) {
      ctx.addIssue({ code: "custom", path: ["bankBranch"], message: ERROR.BRANCH_REQUIRED });
    }
    if (!data.bankAccount.trim()) {
      ctx.addIssue({ code: "custom", path: ["bankAccount"], message: ERROR.ACCOUNT_REQUIRED });
    }
    if (data.bankAccountType === "") {
      ctx.addIssue({
        code: "custom",
        path: ["bankAccountType"],
        message: ERROR.ACCOUNT_TYPE_REQUIRED,
      });
    }
  })
  // Narrows bankAccountType — the refine rejects the empty case so this
  // branch is never taken at runtime.
  .transform((data): BankingFormOutput => {
    if (data.bankAccountType === "") {
      throw new Error("unreachable: superRefine rejects empty bankAccountType");
    }
    return { ...data, bankAccountType: data.bankAccountType };
  });

export type BankingFormValues = z.output<typeof bankingSchema>;

export const BANKING_FORM_DEFAULTS: BankingFormInput = {
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "",
  bankPixKey: "",
};
