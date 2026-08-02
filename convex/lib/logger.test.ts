import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logInfo, logWarn, redactForLog, redactPii } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redactPii", () => {
  it.each([
    ["529.982.247-25", "[REDACTED:CPF]"],
    ["52998224725", "[REDACTED:CPF]"],
    ["529982247-25", "[REDACTED:CPF]"],
  ])("redacts a CPF written as %s", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("redacts a CPF embedded mid-string", () => {
    expect(redactPii("underwriting failed for tenant 529.982.247-25 on contract ctr_01HZX3")).toBe(
      "underwriting failed for tenant [REDACTED:CPF] on contract ctr_01HZX3",
    );
  });

  it("redacts an unformatted CPF glued to surrounding key-value text", () => {
    expect(redactPii("taxId=52998224725;status=rejected")).toBe(
      "taxId=[REDACTED:CPF];status=rejected",
    );
  });

  it.each([
    ["12.345.678/0001-95", "[REDACTED:CNPJ]"],
    ["12345678000195", "[REDACTED:CNPJ]"],
  ])("redacts a CNPJ written as %s", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("redacts a CNPJ embedded mid-string", () => {
    expect(redactPii("agency 12.345.678/0001-95 onboarding stalled")).toBe(
      "agency [REDACTED:CNPJ] onboarding stalled",
    );
  });

  it.each([
    ["joao.silva@example.com", "[REDACTED:EMAIL]"],
    ["JOAO+waitlist@sub.example.com.br", "[REDACTED:EMAIL]"],
    ["12345@example.com", "[REDACTED:EMAIL]"],
  ])("redacts an e-mail written as %s", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("redacts an e-mail embedded mid-string", () => {
    expect(redactPii("welcome mail bounced for joao.silva@example.com after 3 tries")).toBe(
      "welcome mail bounced for [REDACTED:EMAIL] after 3 tries",
    );
  });

  it.each([
    ["(11) 98765-4321", "[REDACTED:PHONE]"],
    ["+55 11 98765-4321", "[REDACTED:PHONE]"],
    ["11 3456-7890", "[REDACTED:PHONE]"],
  ])("redacts a phone number written as %s", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("redacts a phone number embedded mid-string", () => {
    expect(redactPii("sms to (11) 98765-4321 failed")).toBe("sms to [REDACTED:PHONE] failed");
  });

  it("redacts every occurrence in a string carrying several identifiers", () => {
    expect(
      redactPii(
        "tenant 529.982.247-25 joao.silva@example.com (11) 98765-4321 agency 12345678000195",
      ),
    ).toBe("tenant [REDACTED:CPF] [REDACTED:EMAIL] [REDACTED:PHONE] agency [REDACTED:CNPJ]");
  });

  it("leaves non-personal identifiers and amounts untouched", () => {
    expect(redactPii("contract ctr_01HZX3 amount 1.234,56 BRL at 2026-08-02T10:20:30.000Z")).toBe(
      "contract ctr_01HZX3 amount 1.234,56 BRL at 2026-08-02T10:20:30.000Z",
    );
  });
});

describe("redactForLog", () => {
  it("redacts strings nested in objects and arrays", () => {
    expect(
      redactForLog({
        audience: "imobiliaria",
        contacts: [{ email: "joao.silva@example.com" }, { taxId: "529.982.247-25" }],
      }),
    ).toEqual({
      audience: "imobiliaria",
      contacts: [{ email: "[REDACTED:EMAIL]" }, { taxId: "[REDACTED:CPF]" }],
    });
  });

  it("redacts an Error down to its name and a scrubbed message", () => {
    expect(redactForLog(new TypeError("invalid recipient joao.silva@example.com"))).toEqual({
      name: "TypeError",
      message: "invalid recipient [REDACTED:EMAIL]",
    });
  });

  it("passes non-string primitives through unchanged", () => {
    expect(redactForLog({ count: 3, ok: true, missing: null, absent: undefined })).toEqual({
      count: 3,
      ok: true,
      missing: null,
      absent: undefined,
    });
  });

  it("cuts off below the depth ceiling instead of walking forever", () => {
    expect(
      redactForLog({ a: { b: { c: { d: { e: { f: { g: "joao@example.com" } } } } } } }),
    ).toEqual({ a: { b: { c: { d: { e: { f: "[REDACTED:DEPTH]" } } } } } });
  });
});

describe("log emitters", () => {
  it("logInfo redacts both the message and the context", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("synced joao.silva@example.com", { taxId: "529.982.247-25" });
    expect(spy).toHaveBeenCalledWith("synced [REDACTED:EMAIL]", { taxId: "[REDACTED:CPF]" });
  });

  it("logWarn omits the context argument when none is given", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("no local order for 8f2a-91bc");
    expect(spy).toHaveBeenCalledWith("no local order for 8f2a-91bc");
  });

  it("logError redacts the message and the context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("welcome email failed for joao.silva@example.com", {
      audience: "imobiliaria",
      error: new Error("recipient 12.345.678/0001-95 rejected"),
    });
    expect(spy).toHaveBeenCalledWith("welcome email failed for [REDACTED:EMAIL]", {
      audience: "imobiliaria",
      error: { name: "Error", message: "recipient [REDACTED:CNPJ] rejected" },
    });
  });
});
