import { describe, expect, test } from "vitest";
import {
  INVITE_TTL_DAYS,
  canManageMembers,
  canTransitionOnboarding,
  computeInviteExpiry,
  decideRemoval,
  decideRoleChange,
  isInviteExpired,
  isInviteOpen,
  isKybChecklistComplete,
  nextKybChecks,
  isValidEmail,
  normalizeEmail,
} from "./domain";
import type { MemberRole, OnboardingState } from "./domain";

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

const STATES: readonly OnboardingState[] = [
  "not_started",
  "in_progress",
  "submitted",
  "under_review",
  "active",
  "rejected",
];

const ALLOWED: ReadonlyArray<readonly [OnboardingState, OnboardingState]> = [
  ["not_started", "in_progress"],
  ["in_progress", "submitted"],
  ["submitted", "under_review"],
  ["submitted", "active"],
  ["submitted", "rejected"],
  ["under_review", "active"],
  ["under_review", "rejected"],
  ["rejected", "in_progress"],
];

const isAllowed = (from: OnboardingState, to: OnboardingState) =>
  ALLOWED.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);

const ALL_PAIRS = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));

describe("canTransitionOnboarding", () => {
  test.each(ALLOWED)("%s → %s is allowed", (from, to) => {
    expect(canTransitionOnboarding({ from, to })).toBe(true);
  });

  test.each(ALL_PAIRS.filter(([from, to]) => !isAllowed(from, to)))(
    "%s → %s is rejected",
    (from, to) => {
      expect(canTransitionOnboarding({ from, to })).toBe(false);
    },
  );

  test("active is terminal", () => {
    for (const to of STATES) {
      expect(canTransitionOnboarding({ from: "active", to })).toBe(false);
    }
  });
});

describe("isKybChecklistComplete", () => {
  const ALL = [
    "tax_id_active",
    "creci_active",
    "sanctions_pep",
    "bank_account_owner",
    "reputation",
  ] as const;

  test("true only when all five items are ticked", () => {
    expect(isKybChecklistComplete(ALL.map((item) => ({ item })))).toBe(true);
  });

  test.each(ALL)("false when %s is missing", (missing) => {
    const checks = ALL.filter((item) => item !== missing).map((item) => ({ item }));
    expect(isKybChecklistComplete(checks)).toBe(false);
  });

  test("false for an absent checklist", () => {
    expect(isKybChecklistComplete(undefined)).toBe(false);
  });
});

describe("nextKybChecks", () => {
  const TICK = {
    item: "creci_active",
    checkedBy: ALICE,
    checkedAt: "2026-11-01T00:00:00Z",
  } as const;

  test("ticking an unticked item appends it with who and when", () => {
    expect(
      nextKybChecks({
        checks: undefined,
        item: "creci_active",
        checked: true,
        checkedBy: ALICE,
        checkedAt: "2026-11-01T00:00:00Z",
      }),
    ).toEqual([TICK]);
  });

  test("ticking a ticked item changes nothing and keeps the original reviewer", () => {
    expect(
      nextKybChecks({
        checks: [TICK],
        item: "creci_active",
        checked: true,
        checkedBy: BOB,
        checkedAt: "2026-11-02T00:00:00Z",
      }),
    ).toBeNull();
  });

  test("unticking removes only that item", () => {
    const other = { ...TICK, item: "reputation" } as const;
    expect(
      nextKybChecks({
        checks: [TICK, other],
        item: "creci_active",
        checked: false,
        checkedBy: BOB,
        checkedAt: "2026-11-02T00:00:00Z",
      }),
    ).toEqual([other]);
  });

  test("unticking an unticked item changes nothing", () => {
    expect(
      nextKybChecks({
        checks: [],
        item: "creci_active",
        checked: false,
        checkedBy: BOB,
        checkedAt: "2026-11-02T00:00:00Z",
      }),
    ).toBeNull();
  });
});
