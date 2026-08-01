import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";

/**
 * `signedInAs` is the one `accessDenied` message using rich-text tags, and it
 * only renders in the not-staff state — the state a local dev session cannot
 * easily reach. A malformed ICU tag would surface as a 500 on the page's main
 * path, so the syntax is asserted here instead.
 */
const locales = { "pt-BR": ptBR, en } as const;

/**
 * Listed literally rather than derived from the message files, so a key deleted
 * from both locales fails here instead of silently shrinking the assertion.
 */
const PLAIN_KEYS = [
  "eyebrow",
  "title",
  "subtitle",
  "anonymousEyebrow",
  "anonymousTitle",
  "anonymousSubtitle",
  "staffEyebrow",
  "staffTitle",
  "staffSubtitle",
  "goToAgency",
  "goToAdmin",
  "signIn",
  "signOut",
] as const;

describe("accessDenied messages", () => {
  for (const [locale, messages] of Object.entries(locales)) {
    describe(locale, () => {
      const t = createTranslator({ locale, messages, namespace: "accessDenied" });

      it("formats signedInAs with the <mono> tag and email value", () => {
        const parts = t.rich("signedInAs", {
          email: "someone@example.com",
          mono: (chunks) => `[${chunks}]`,
        });
        // Rich text returns an array of chunks; flatten to plain text.
        const text = (Array.isArray(parts) ? parts.join("") : String(parts)).trim();
        expect(text).toContain("[someone@example.com]");
      });

      it("defines exactly the keys the view model can emit", () => {
        expect(Object.keys(messages.accessDenied).sort()).toEqual(
          [...PLAIN_KEYS, "signedInAs"].sort(),
        );
      });

      it("formats every non-rich message to a non-empty string", () => {
        for (const key of PLAIN_KEYS) {
          expect(t(key)).not.toBe("");
        }
      });
    });
  }
});
