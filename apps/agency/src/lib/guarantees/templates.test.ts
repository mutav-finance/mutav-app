import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHIPPED_TEMPLATE_FILES, templateHref } from "./templates";

const TEMPLATES_DIR = path.resolve(__dirname, "../../../public/templates");

describe("SHIPPED_TEMPLATE_FILES", () => {
  it("lists exactly the PDFs under public/templates", () => {
    const onDisk = existsSync(TEMPLATES_DIR)
      ? readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith(".pdf"))
      : [];
    expect([...SHIPPED_TEMPLATE_FILES].sort()).toEqual(onDisk.sort());
  });

  it("returns no link for a template that is not shipped", () => {
    expect(templateHref("not-a-template")).toBeNull();
  });
});
