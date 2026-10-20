import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ERROR_CODES,
  FORBIDDEN_MESSAGE_KEY,
  UNEXPECTED_MESSAGE_KEY,
  canSubmitRejection,
  errorMessageKey,
  formatFileSize,
  thrownMessageKey,
} from "./view-model";

const MESSAGES_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../messages");

function readNamespace(locale: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("guaranteeDocuments" in parsed)) {
    throw new Error(`${locale}.json has no guaranteeDocuments namespace`);
  }
  const namespace = parsed.guaranteeDocuments;
  if (typeof namespace !== "object" || namespace === null || !("errors" in namespace)) {
    throw new Error(`${locale}.json guaranteeDocuments has no errors`);
  }
  const errors = namespace.errors;
  if (typeof errors !== "object" || errors === null) throw new Error("errors is not an object");
  return Object.fromEntries(Object.entries(errors));
}

describe("errorMessageKey", () => {
  it("maps a known code to its key", () => {
    expect(errorMessageKey("FILE_TOO_LARGE")).toBe("errors.FILE_TOO_LARGE");
  });

  it("falls back for an unknown code", () => {
    expect(errorMessageKey("SOMETHING_NEW")).toBe(UNEXPECTED_MESSAGE_KEY);
  });

  it.each(["pt-BR", "en"])("every code plus the fallbacks is translated in %s", (locale) => {
    const errors = readNamespace(locale);
    for (const code of [...DOCUMENT_ERROR_CODES, "unexpected", "FORBIDDEN"]) {
      expect(errors[code], `${locale} errors.${code}`).toEqual(expect.any(String));
    }
  });
});

describe("thrownMessageKey", () => {
  it("names a role refusal", () => {
    expect(thrownMessageKey(new Error("Requires 'compliance' role or higher"))).toBe(
      FORBIDDEN_MESSAGE_KEY,
    );
  });

  it("falls back otherwise", () => {
    expect(thrownMessageKey(new Error("network"))).toBe(UNEXPECTED_MESSAGE_KEY);
  });
});

describe("canSubmitRejection", () => {
  it.each([
    ["", false],
    ["   ", false],
    ["Signature missing", true],
  ])("%j → %s", (reason, expected) => {
    expect(canSubmitRejection(reason)).toBe(expected);
  });
});

describe("formatFileSize", () => {
  it.each([
    [100, "1 KB"],
    [2048, "2 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
  ])("%i → %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
