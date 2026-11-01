import { describe, expect, it } from "vitest";

import { CLAIM_STATUS_NAMES, CLAIM_STATUS_TONE } from "@mutav/ui/claim-status-tag";
import { AGENCY_CASE_STATUSES } from "@convex/delinquencies/domain";

describe("claim status tag", () => {
  it("names exactly the case statuses the server can return", () => {
    expect([...CLAIM_STATUS_NAMES].sort()).toEqual([...AGENCY_CASE_STATUSES].sort());
  });

  it("gives every status a tone", () => {
    for (const status of AGENCY_CASE_STATUSES) {
      expect(CLAIM_STATUS_TONE[status]).toBeDefined();
    }
  });
});
