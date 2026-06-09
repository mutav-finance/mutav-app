// @vitest-environment edge-runtime
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import {
  getAuth0MgmtClientId,
  getAuth0MgmtClientSecret,
  getMaxGuaranteeCapacityCents,
} from "./env";

describe("getAuth0MgmtClientId", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_ID;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_ID;
    else process.env.AUTH0_MGMT_CLIENT_ID = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_ID = "mgmt_client_xyz";
    expect(getAuth0MgmtClientId()).toBe("mgmt_client_xyz");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_ID;
    expect(() => getAuth0MgmtClientId()).toThrow(/AUTH0_MGMT_CLIENT_ID/);
  });
});

describe("getAuth0MgmtClientSecret", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.AUTH0_MGMT_CLIENT_SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    else process.env.AUTH0_MGMT_CLIENT_SECRET = original;
  });

  test("returns the value when set", () => {
    process.env.AUTH0_MGMT_CLIENT_SECRET = "mgmt_secret_abc";
    expect(getAuth0MgmtClientSecret()).toBe("mgmt_secret_abc");
  });

  test("throws a helpful error when missing", () => {
    delete process.env.AUTH0_MGMT_CLIENT_SECRET;
    expect(() => getAuth0MgmtClientSecret()).toThrow(/AUTH0_MGMT_CLIENT_SECRET/);
  });
});

describe("getMaxGuaranteeCapacityCents", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.MAX_GUARANTEE_CAPACITY_CENTS;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.MAX_GUARANTEE_CAPACITY_CENTS;
    else process.env.MAX_GUARANTEE_CAPACITY_CENTS = original;
  });

  test("returns the parsed value when set to a positive integer", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "1000000";
    expect(getMaxGuaranteeCapacityCents()).toBe(1_000_000);
  });

  test("returns the default when unset", () => {
    delete process.env.MAX_GUARANTEE_CAPACITY_CENTS;
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });

  test("returns the default when value is not numeric", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "abc";
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });

  test("returns the default when value is empty string", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "";
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });

  test("returns the default when value is zero", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "0";
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });

  test("returns the default when value is negative", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "-5";
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });

  test("returns the default when value is a non-integer number", () => {
    process.env.MAX_GUARANTEE_CAPACITY_CENTS = "1.5";
    expect(getMaxGuaranteeCapacityCents()).toBe(500_000_000);
  });
});
