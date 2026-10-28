import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import { resolveSessionErrorView, type SessionErrorReason } from "./view-model";

const locales = { "pt-BR": ptBR, en } as const;
const REASONS: readonly SessionErrorReason[] = [
  "not-provisioned",
  "backend-unavailable",
  "email-not-verified",
  "email-bound",
];

describe("sessionError messages", () => {
  for (const [locale, messages] of Object.entries(locales)) {
    describe(locale, () => {
      const t = createTranslator({ locale, messages, namespace: "sessionError" });

      it("formats every key the view model can emit", () => {
        for (const reason of REASONS) {
          const view = resolveSessionErrorView(reason);
          for (const key of [view.eyebrowKey, view.titleKey, view.subtitleKey]) {
            expect(t(key)).not.toBe("");
          }
        }
      });

      it("formats both action labels", () => {
        expect(t("tryAgain")).not.toBe("");
        expect(t("logOut")).not.toBe("");
      });
    });
  }
});
