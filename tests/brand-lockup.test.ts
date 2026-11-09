import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Lockup } from "@mutav/brand/lockup";
import { LockupImage } from "@mutav/brand/lockup-image";
import { LOCKUP_WORD_PATH } from "@mutav/brand/lockup-geometry";

/**
 * The lockup's word is the outlined path from the brand repo's kit
 * (`brand/kit/logo/svg/mutav-lockup-light.svg`). The kit lives in a sibling
 * repo CI cannot read, so the path is pinned by the SHA-256 of the kit's `d`
 * attribute: a retyped or re-derived path fails here.
 */
const KIT_WORD_PATH_SHA256 = "5b7286797dd8ab7ad3ec7c54b23f25b7b8609642b17bda928f2c8f8b379c9fca";
const KIT_WORD_TRANSFORM = 'transform="translate(83.490 56.400)"';

function attribute(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, "g"))].map((match) => match[1] ?? "");
}

describe("Lockup", () => {
  const html = renderToStaticMarkup(createElement(Lockup, { className: "h-6 w-auto" }));

  it("renders one svg named MUTAV", () => {
    expect(html.startsWith("<svg")).toBe(true);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="MUTAV"');
    expect(html).not.toContain("aria-hidden");
  });

  it("uses the kit's 360.168 × 60 view box", () => {
    expect(html).toContain('viewBox="0 0 360.168 60"');
  });

  it("carries the kit's word path, verbatim, at the kit's offset", () => {
    expect(createHash("sha256").update(LOCKUP_WORD_PATH).digest("hex")).toBe(KIT_WORD_PATH_SHA256);
    expect(attribute(html, "d")).toContain(LOCKUP_WORD_PATH);
    expect(html).toContain(KIT_WORD_TRANSFORM);
  });

  it("colors letters with currentColor and the pill and word with the accent", () => {
    expect(attribute(html, "fill")).toEqual([
      "currentColor",
      "currentColor",
      "currentColor",
      "currentColor",
      "var(--accent)",
      "var(--accent)",
    ]);
  });

  it("passes the caller's className through and ships none of its own", () => {
    expect(attribute(html, "class")).toEqual(["h-6 w-auto"]);
  });
});

describe("LockupImage", () => {
  it("sizes by height at the 6:1 ratio with paper colors by default", () => {
    const html = renderToStaticMarkup(createElement(LockupImage, { height: 120 }));
    expect(html).toContain('width="720" height="120"');
    expect(attribute(html, "fill")).toEqual([
      "#1A1A1A",
      "#1A1A1A",
      "#1A1A1A",
      "#1A1A1A",
      "#C47E10",
      "#C47E10",
    ]);
  });

  it("uses warm white and Amber on the dark variant", () => {
    const html = renderToStaticMarkup(createElement(LockupImage, { height: 60, variant: "dark" }));
    expect(attribute(html, "fill")).toEqual([
      "#F0F0EE",
      "#F0F0EE",
      "#F0F0EE",
      "#F0F0EE",
      "#E8A020",
      "#E8A020",
    ]);
  });
});
