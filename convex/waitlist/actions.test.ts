// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { addToResendAudience, buildImobiliariaWelcomeHtml, sendWelcomeEmail } from "./actions";

const SIGNUP_EMAIL = "joao.silva@example.com";

// A registered Convex function carries its declared args validator as an
// `exportArgs()` serialization. Reading it asserts the declaration itself
// rather than one call's behaviour, so re-adding an address argument fails
// here even if nothing ever passes one.
type ArgsExporter = { exportArgs: () => string };

function isArgsExporter(value: unknown): value is ArgsExporter {
  return typeof value === "function" && "exportArgs" in value;
}

function declaredArgs(fn: unknown): string {
  if (!isArgsExporter(fn)) throw new Error("not a registered Convex function");
  return fn.exportArgs();
}

const DELIVERY_ACTIONS = [
  ["addToResendAudience", addToResendAudience],
  ["sendWelcomeEmail", sendWelcomeEmail],
] as const;

describe("delivery actions — declared arguments", () => {
  test.each(DELIVERY_ACTIONS)("%s declares no address argument", (_name, fn) => {
    const args = declaredArgs(fn);
    expect(args).not.toContain("email");
    expect(args).not.toContain("audience");
  });

  test.each(DELIVERY_ACTIONS)("%s takes a waitlist row id instead", (_name, fn) => {
    const args = declaredArgs(fn);
    expect(args).toContain('"waitlistId"');
    expect(args).toContain('"tableName":"waitlist"');
  });
});

describe("delivery actions — resolve by row id", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The vendor guard sits behind the row lookup, so an unset key is what
    // stops these tests short of a real Resend call.
    delete process.env.RESEND_API_KEY; // hook-ok: test fixture — direct env mutation is the only way to unset a secret for convex-test
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  async function seedRow(t: ReturnType<typeof convexTest>) {
    return t.run((ctx) =>
      ctx.db.insert("waitlist", {
        email: SIGNUP_EMAIL,
        audience: "imobiliaria",
        ts: 1_700_000_000_000,
      }),
    );
  }

  test.each(DELIVERY_ACTIONS)(
    "%s resolves a live row and reaches the vendor-config guard",
    async (name) => {
      const t = convexTest(schema);
      const waitlistId = await seedRow(t);

      // `null` is how the harness renders a void action return; the assertion
      // that matters is that it resolves rather than rejects.
      await expect(t.action(internal.waitlist.actions[name], { waitlistId })).resolves.toBeNull();

      // Past the lookup, so the skip reported is the missing key — not a
      // missing row.
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY not set"));
    },
  );

  test.each(DELIVERY_ACTIONS)("%s no-ops on a row erased before execution", async (name) => {
    const t = convexTest(schema);
    const waitlistId = await seedRow(t);
    await t.run((ctx) => ctx.db.delete(waitlistId));

    // A warning, then a no-op return — never a throw. Failing a fire-and-forget
    // side effect over a benign erasure race would put a red scheduled-function
    // entry on the dashboard for something nobody needs to act on.
    await expect(t.action(internal.waitlist.actions[name], { waitlistId })).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("row no longer exists"), {
      caller: name,
      waitlistId,
    });
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY not set"));
  });

  test.each(DELIVERY_ACTIONS)("%s keeps the address out of what it logs", async (name) => {
    const t = convexTest(schema);
    const waitlistId = await seedRow(t);

    await t.action(internal.waitlist.actions[name], { waitlistId });

    expect(JSON.stringify(warn.mock.calls)).not.toContain(SIGNUP_EMAIL);
  });
});

describe("buildImobiliariaWelcomeHtml", () => {
  const html = buildImobiliariaWelcomeHtml({ appUrl: "https://app.mutav.test" });

  test("uses the shared branded header, not the old caps lockup", () => {
    expect(html).toContain('src="https://app.mutav.test/email/mutav-logo.png"');
    expect(html).toContain('alt="MUTAV"');
    expect(html).toMatch(/>mutav<\/span>/);
    expect(html).not.toContain("app.mutav.finance/email");
  });

  test("uses the shared footer: descriptor, support mailto and reason", () => {
    expect(html).toContain("MUTAV · Garantia locatícia");
    expect(html).toContain('href="mailto:contato@mutav.finance"');
    expect(html).toContain("Você recebeu este e-mail porque você se cadastrou na lista de espera");
  });

  test("keeps the book-a-call button and the Instagram link", () => {
    expect(html).toContain('href="https://calendar.app.google/41vSpkz8pMoK7Saw9"');
    expect(html).toContain("Agendar uma conversa");
    expect(html).toContain('href="https://www.instagram.com/mutav.br/"');
  });
});
