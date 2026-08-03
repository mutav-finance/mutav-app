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

  it.each([
    ["5511987654321", "[REDACTED:PHONE]"],
    ["551134567890", "[REDACTED:PHONE]"],
    ["+5511987654321", "[REDACTED:PHONE]"],
  ])("redacts E.164 written without a leading plus as %s", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("redacts a bare E.164 phone embedded in a vendor payload dump", () => {
    expect(redactPii('{"to":"5511987654321","status":"failed"}')).toBe(
      '{"to":"[REDACTED:PHONE]","status":"failed"}',
    );
  });

  it.each([
    ["1754160000", "1754160000"],
    ["1754160000000", "1754160000000"],
    ["4200000001", "4200000001"],
  ])("leaves the bare digit run %s untouched", (input, expected) => {
    expect(redactPii(input)).toBe(expected);
  });

  it("leaves a unix-seconds timestamp and a numeric external id readable", () => {
    expect(redactPii("order 4200000001 quoted at 1754160000 expired")).toBe(
      "order 4200000001 quoted at 1754160000 expired",
    );
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
      // `email` and `taxId` are PII field names, so the key rule fires before
      // the value patterns get a look. Strictly stronger: it does not depend
      // on the value having a recognisable shape.
      contacts: [{ email: "[REDACTED:FIELD]" }, { taxId: "[REDACTED:FIELD]" }],
    });
  });

  it("keeps an Error's stack, scrubbed, rather than dropping it", () => {
    const redacted = redactForLog(new TypeError("invalid recipient joao.silva@example.com")) as {
      name: string;
      message: string;
      stack: string;
    };

    expect(redacted.name).toBe("TypeError");
    expect(redacted.message).toBe("invalid recipient [REDACTED:EMAIL]");
    // Dropping the stack turned an unexpected throw into a one-line message
    // with no origin. It is kept and scrubbed, not discarded.
    expect(redacted.stack).toContain("TypeError: invalid recipient [REDACTED:EMAIL]");
    expect(redacted.stack).not.toContain("joao.silva@example.com");
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
    expect(spy).toHaveBeenCalledWith("synced [REDACTED:EMAIL]", { taxId: "[REDACTED:FIELD]" });
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
      error: expect.objectContaining({
        name: "Error",
        message: "recipient [REDACTED:CNPJ] rejected",
        stack: expect.stringContaining("[REDACTED:CNPJ]"),
      }),
    });
  });
});

describe("shapeless personal data (key-based redaction)", () => {
  it("redacts fields no value pattern can recognise", () => {
    // None of these have a shape a regex could match — a name is just a
    // string. Before the key rule they passed through in clear text.
    expect(
      redactForLog({
        fullName: "Joao da Silva Pereira",
        birthDate: "1985-03-14",
        cep: "01310100",
        streetAndNumber: "Rua das Flores 123",
        complement: "apto 45",
        accountNumber: "0004321",
        accountHolderName: "Maria Souza",
        rg: "12.345.678-9",
      }),
    ).toEqual({
      fullName: "[REDACTED:FIELD]",
      birthDate: "[REDACTED:FIELD]",
      cep: "[REDACTED:FIELD]",
      streetAndNumber: "[REDACTED:FIELD]",
      complement: "[REDACTED:FIELD]",
      accountNumber: "[REDACTED:FIELD]",
      accountHolderName: "[REDACTED:FIELD]",
      rg: "[REDACTED:FIELD]",
    });
  });

  it("redacts a PII field whose value is a whole subtree", () => {
    expect(redactForLog({ address: { cep: "01310-100", city: "Sao Paulo" } })).toEqual({
      address: "[REDACTED:FIELD]",
    });
  });

  it("redacts an agency name, since a MEI's company name is a person's name", () => {
    expect(redactForLog({ name: "Joao da Silva ME" })).toEqual({ name: "[REDACTED:FIELD]" });
  });

  it("redacts object keys, not just values", () => {
    // A dedupe set or per-recipient result map keyed by address leaks the
    // identifier wholesale even when every value is harmless.
    expect(redactForLog({ "joao@example.com": { delivered: true } })).toEqual({
      "[REDACTED:EMAIL]": { delivered: true },
    });
  });

  it("leaves operational fields readable", () => {
    expect(
      redactForLog({
        provider: "etherfuse",
        status: "approved",
        orderId: "ord_8f2a91bc",
        amountCents: 250000,
      }),
    ).toEqual({
      provider: "etherfuse",
      status: "approved",
      orderId: "ord_8f2a91bc",
      amountCents: 250000,
    });
  });
});

describe("over-redaction guards", () => {
  it("leaves a transaction hash intact", () => {
    // The old digit-only boundaries let a digit run inside a hex id match,
    // mangling ~4% of tx hashes into [REDACTED:CPF] and making them
    // unsearchable — hashes are the join key for chain reconciliation.
    expect(redactPii("tx a1b12345678901cdef9900aabb")).toBe("tx a1b12345678901cdef9900aabb");
    expect(redactPii("tx ff12345678901234ab")).toBe("tx ff12345678901234ab");
  });

  it("still redacts an identifier delimited by punctuation or whitespace", () => {
    expect(redactPii("taxId=52998224725")).toBe("taxId=[REDACTED:CPF]");
    expect(redactPii('{"to":"5511987654321"}')).toBe('{"to":"[REDACTED:PHONE]"}');
  });

  it("renders Date, Map and Set instead of collapsing them to {}", () => {
    const shaped = redactForLog({
      seenAt: new Date("2026-08-03T12:00:00.000Z"),
      pending: new Set(["ord_1", "ord_2"]),
      byStatus: new Map([["approved", 2]]),
    });

    expect(shaped).toEqual({
      seenAt: "2026-08-03T12:00:00.000Z",
      pending: ["ord_1", "ord_2"],
      byStatus: { approved: 2 },
    });
  });

  it("keeps a ConvexError-style data payload and an error cause", () => {
    const inner = new Error("upstream refused");
    const outer = new Error("provisioning failed", { cause: inner }) as Error & { data: unknown };
    outer.data = { code: "ANCHOR_START_FAILED", email: "joao@example.com" };

    const shaped = redactForLog(outer) as {
      data: { code: string; email: string };
      cause: { message: string };
    };

    // `data` carries the error code the whole convention rests on — dropping
    // it was an over-redaction, so it is kept and scrubbed instead.
    expect(shaped.data.code).toBe("ANCHOR_START_FAILED");
    expect(shaped.data.email).toBe("[REDACTED:FIELD]");
    expect(shaped.cause.message).toBe("upstream refused");
  });
});
