import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuth0AdminOrgId } from "./env";

describe("getAuth0AdminOrgId", () => {
  const originalValue = process.env.AUTH0_ADMIN_ORG_ID;

  beforeEach(() => {
    delete process.env.AUTH0_ADMIN_ORG_ID;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.AUTH0_ADMIN_ORG_ID;
      return;
    }
    process.env.AUTH0_ADMIN_ORG_ID = originalValue;
  });

  it("returns the configured Auth0 Organization id", () => {
    process.env.AUTH0_ADMIN_ORG_ID = "org_abc123";
    expect(getAuth0AdminOrgId()).toBe("org_abc123");
  });

  it("throws when AUTH0_ADMIN_ORG_ID is unset", () => {
    expect(() => getAuth0AdminOrgId()).toThrow(/AUTH0_ADMIN_ORG_ID is required/);
  });

  it("throws when AUTH0_ADMIN_ORG_ID is an empty string", () => {
    process.env.AUTH0_ADMIN_ORG_ID = "";
    expect(() => getAuth0AdminOrgId()).toThrow(/AUTH0_ADMIN_ORG_ID is required/);
  });
});
