import { describe, expect, test } from "vitest";
import { escapeHtml } from "./escape";
import { renderEmailLayout } from "./layout";

const BASE = {
  appUrl: "https://app.mutav.test",
  title: "Assunto — MUTAV",
  bodyHtml: "<p>Corpo</p>",
  reason: "a sua imobiliária se cadastrou na MUTAV.",
};

describe("escapeHtml", () => {
  test("neutralises markup and quotes", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });
});

describe("renderEmailLayout", () => {
  const html = renderEmailLayout(BASE);

  test("is a full HTML document", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("<title>Assunto — MUTAV</title>");
  });

  test("header shows the lockup image served from the app origin, alt MUTAV", () => {
    expect(html).toContain('src="https://app.mutav.test/email/mutav-lockup.png"');
    expect(html).toContain('alt="MUTAV"');
    expect(html).toContain('width="192" height="32"');
  });

  test("tolerates a trailing slash on the app origin", () => {
    const withSlash = renderEmailLayout({ ...BASE, appUrl: "https://app.mutav.test/" });
    expect(withSlash).toContain('src="https://app.mutav.test/email/mutav-lockup.png"');
  });

  test("header carries no live-text wordmark next to the lockup image", () => {
    expect(html).not.toMatch(/>mutav<\/span>/i);
  });

  test("renders the body slot as given", () => {
    expect(html).toContain("<p>Corpo</p>");
  });

  test("footer carries the descriptor, the support mailto and the reason", () => {
    expect(html).toContain("MUTAV · Garantia locatícia");
    expect(html).toContain('href="mailto:contato@mutav.finance"');
    expect(html).toContain(
      "Você recebeu este e-mail porque a sua imobiliária se cadastrou na MUTAV.",
    );
  });

  test("has no button and no heading when none is given", () => {
    expect(html).not.toContain('bgcolor="#c47e10"');
    expect(html).not.toContain("<h1");
  });

  test("renders the button with its label and link", () => {
    const withCta = renderEmailLayout({
      ...BASE,
      cta: { label: "Entrar no painel", url: "https://app.mutav.test/x?a=1&b=2" },
    });
    expect(withCta).toContain('bgcolor="#c47e10"');
    expect(withCta).toContain('href="https://app.mutav.test/x?a=1&amp;b=2"');
    expect(withCta).toContain(">Entrar no painel</a>");
  });

  test("escapes plain-text fields", () => {
    const hostile = renderEmailLayout({
      ...BASE,
      title: "<b>t</b>",
      preheader: "<i>p</i>",
      heading: "<h2>x</h2>",
      cta: { label: "<script>", url: 'https://x.test/"onmouseover="y' },
      reason: "Imob <img src=x>.",
    });
    expect(hostile).toContain("<title>&lt;b&gt;t&lt;/b&gt;</title>");
    expect(hostile).toContain("&lt;i&gt;p&lt;/i&gt;");
    expect(hostile).toContain("&lt;h2&gt;x&lt;/h2&gt;");
    expect(hostile).toContain("&lt;script&gt;");
    expect(hostile).toContain('href="https://x.test/&quot;onmouseover=&quot;y"');
    expect(hostile).toContain("Imob &lt;img src=x&gt;.");
    expect(hostile).not.toContain("<script>");
    expect(hostile).not.toContain("<img src=x>");
  });
});
