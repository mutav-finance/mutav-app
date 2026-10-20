import { describe, expect, test } from "vitest";
import {
  INVITE_TTL_DAYS,
  canManageMembers,
  computeInviteExpiry,
  decideRemoval,
  decideRoleChange,
  isInviteExpired,
  isInviteOpen,
  isValidEmail,
  normalizeEmail,
} from "./domain";
import type { MemberRole } from "./domain";

const ALICE = "alice";
const BOB = "bob";

const member = (userId: string, role: MemberRole) => ({ userId, role });

describe("email rules", () => {
  test("normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Ana.Silva@Example.COM ")).toBe("ana.silva@example.com");
  });

  test.each([
    ["ana@example.com", true],
    [" ANA@EXAMPLE.COM ", true],
    ["ana@example", false],
    ["ana example@x.com", false],
    ["@example.com", false],
    ["", false],
  ])("isValidEmail(%j) → %s", (email, expected) => {
    expect(isValidEmail(email)).toBe(expected);
  });
});

describe("invite expiry", () => {
  test("TTL is seven days", () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(computeInviteExpiry("2026-10-01T12:00:00.000Z")).toBe("2026-10-08T12:00:00.000Z");
  });

  test("expires exactly at expiresAt", () => {
    const invite = { expiresAt: "2026-10-08T12:00:00.000Z" };
    expect(isInviteExpired(invite, "2026-10-08T11:59:59.999Z")).toBe(false);
    expect(isInviteExpired(invite, "2026-10-08T12:00:00.000Z")).toBe(true);
  });

  test.each([
    ["pending", "2026-10-02T00:00:00.000Z", true],
    ["pending", "2026-10-09T00:00:00.000Z", false],
    ["accepted", "2026-10-02T00:00:00.000Z", false],
    ["revoked", "2026-10-02T00:00:00.000Z", false],
    ["expired", "2026-10-02T00:00:00.000Z", false],
  ] as const)("isInviteOpen(status=%s, now=%s) → %s", (status, now, expected) => {
    expect(isInviteOpen({ status, expiresAt: "2026-10-08T12:00:00.000Z" }, now)).toBe(expected);
  });
});

describe("canManageMembers", () => {
  test.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("%s → %s", (role, expected) => {
    expect(canManageMembers(role)).toBe(expected);
  });
});

describe("decideRoleChange", () => {
  test("owner may promote a member to owner", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "owner"),
        target: member(BOB, "member"),
        nextRole: "owner",
        ownerCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  test("owner may demote another owner while a second owner remains", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "owner"),
        target: member(BOB, "owner"),
        nextRole: "admin",
        ownerCount: 2,
      }),
    ).toEqual({ allowed: true });
  });

  test("admin may move a member to admin", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "admin"),
        target: member(BOB, "member"),
        nextRole: "admin",
        ownerCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  test("nobody changes their own role", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "owner"),
        target: member(ALICE, "owner"),
        nextRole: "member",
        ownerCount: 2,
      }),
    ).toEqual({ allowed: false, code: "CANNOT_CHANGE_OWN_ROLE" });
  });

  test("a member cannot change roles", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "member"),
        target: member(BOB, "member"),
        nextRole: "admin",
        ownerCount: 1,
      }),
    ).toEqual({ allowed: false, code: "INSUFFICIENT_ROLE" });
  });

  test("admin cannot touch an owner", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "admin"),
        target: member(BOB, "owner"),
        nextRole: "member",
        ownerCount: 2,
      }),
    ).toEqual({ allowed: false, code: "INSUFFICIENT_ROLE" });
  });

  test("admin cannot grant owner", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "admin"),
        target: member(BOB, "member"),
        nextRole: "owner",
        ownerCount: 1,
      }),
    ).toEqual({ allowed: false, code: "INSUFFICIENT_ROLE" });
  });

  test("the last owner cannot be demoted", () => {
    expect(
      decideRoleChange({
        actor: member(ALICE, "owner"),
        target: member(BOB, "owner"),
        nextRole: "admin",
        ownerCount: 1,
      }),
    ).toEqual({ allowed: false, code: "LAST_OWNER" });
  });
});

describe("decideRemoval", () => {
  test("owner may remove an admin", () => {
    expect(
      decideRemoval({
        actor: member(ALICE, "owner"),
        target: member(BOB, "admin"),
        ownerCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  test("admin may remove a member", () => {
    expect(
      decideRemoval({
        actor: member(ALICE, "admin"),
        target: member(BOB, "member"),
        ownerCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  test("nobody removes themselves", () => {
    expect(
      decideRemoval({
        actor: member(ALICE, "owner"),
        target: member(ALICE, "owner"),
        ownerCount: 2,
      }),
    ).toEqual({ allowed: false, code: "CANNOT_REMOVE_SELF" });
  });

  test("a member cannot remove anyone", () => {
    expect(
      decideRemoval({
        actor: member(ALICE, "member"),
        target: member(BOB, "member"),
        ownerCount: 1,
      }),
    ).toEqual({ allowed: false, code: "INSUFFICIENT_ROLE" });
  });

  test("admin cannot remove an owner", () => {
    expect(
      decideRemoval({ actor: member(ALICE, "admin"), target: member(BOB, "owner"), ownerCount: 2 }),
    ).toEqual({ allowed: false, code: "INSUFFICIENT_ROLE" });
  });

  test("the last owner cannot be removed", () => {
    expect(
      decideRemoval({ actor: member(ALICE, "owner"), target: member(BOB, "owner"), ownerCount: 1 }),
    ).toEqual({ allowed: false, code: "LAST_OWNER" });
  });
});
