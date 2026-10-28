import { describe, expect, it } from "vitest";
import { parseSessionErrorReason, resolveSessionErrorView } from "./view-model";

describe("parseSessionErrorReason", () => {
  it("accepts the two known reasons", () => {
    expect(parseSessionErrorReason("not-provisioned")).toBe("not-provisioned");
    expect(parseSessionErrorReason("backend-unavailable")).toBe("backend-unavailable");
  });

  it.each([undefined, "", "session-expired", "<script>", ["not-provisioned", "x"]])(
    "falls back to backend-unavailable for %j",
    (raw) => {
      expect(parseSessionErrorReason(raw)).toBe("backend-unavailable");
    },
  );
});

describe("resolveSessionErrorView", () => {
  it("uses the account-setup copy for not-provisioned", () => {
    expect(resolveSessionErrorView("not-provisioned")).toEqual({
      tone: "notProvisioned",
      eyebrowKey: "notProvisioned.eyebrow",
      titleKey: "notProvisioned.title",
      subtitleKey: "notProvisioned.subtitle",
    });
  });

  it("uses the outage copy for backend-unavailable", () => {
    expect(resolveSessionErrorView("backend-unavailable")).toEqual({
      tone: "backendUnavailable",
      eyebrowKey: "backendUnavailable.eyebrow",
      titleKey: "backendUnavailable.title",
      subtitleKey: "backendUnavailable.subtitle",
    });
  });
});
