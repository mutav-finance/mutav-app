import { describe, expect, test } from "vitest";
import { sameOriginPath } from "./return-to";

describe("sameOriginPath", () => {
  test.each(["/", "/en/invoices", "/invoices?status=open", "/en/guarantees/G-1?tab=history"])(
    "keeps %s",
    (path) => {
      expect(sameOriginPath(path)).toBe(path);
    },
  );

  test.each([null, "", "invoices", "//evil.example", "/\\evil.example", "https://evil.example/"])(
    "refuses %j",
    (value) => {
      expect(sameOriginPath(value)).toBeNull();
    },
  );
});
