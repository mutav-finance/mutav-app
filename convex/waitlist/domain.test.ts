import { describe, expect, it } from "vitest";
import { summarizeBackfillFailures } from "./domain";

describe("summarizeBackfillFailures", () => {
  it("strips the address out of a vendor rejection message", () => {
    expect(
      summarizeBackfillFailures([
        "Invalid `to` field: joao.silva@example.com is not a valid email",
      ]),
    ).toEqual(["Invalid `to` field: [REDACTED:EMAIL] is not a valid email"]);
  });

  it("carries no address through when every row failed for its own recipient", () => {
    expect(
      summarizeBackfillFailures([
        "rejected recipient joao.silva@example.com",
        "rejected recipient maria.souza@example.com",
      ]),
    ).toEqual(["rejected recipient [REDACTED:EMAIL]"]);
  });

  it("keeps distinct vendor reasons apart", () => {
    expect(summarizeBackfillFailures(["rate limit exceeded", "audience not found"])).toEqual([
      "rate limit exceeded",
      "audience not found",
    ]);
  });

  it("returns nothing when no row failed", () => {
    expect(summarizeBackfillFailures([])).toEqual([]);
  });
});
