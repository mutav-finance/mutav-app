import { describe, expect, it, vi } from "vitest";

import { ALLOWED_TRANSITIONS, GUARANTEE_STATE, GUARANTEE_STATES } from "@convex/guarantees/domain";
import {
  GUARANTEE_CURE_ORIGIN_STATES,
  GUARANTEE_EXIT_STATES,
  GUARANTEE_SPINE_STATES,
  buildLifecyclePipeline,
} from "@/components/guarantees/use-guarantee-lifecycle-pipeline";
import type { GuaranteeStateCounts } from "@/lib/guarantees/state-chart";

// The card is a picture of the machine with the agency's own numbers in it.
// Everything it decides — which states are the spine, which are exits, which
// node a count lands on, which nodes recede, and what a click emits — is this
// one pure builder, so it can be asserted without a renderer.

function counts(overrides: Partial<GuaranteeStateCounts> = {}): GuaranteeStateCounts {
  return {
    drafted: 0,
    active: 0,
    in_arrears: 0,
    default_verified: 0,
    cover_committed: 0,
    in_eviction: 0,
    closed: 0,
    ...overrides,
  };
}

function build(args: {
  counts?: GuaranteeStateCounts | null;
  selectedState?: Parameters<typeof buildLifecyclePipeline>[0]["selectedState"];
  onSelectState?: Parameters<typeof buildLifecyclePipeline>[0]["onSelectState"];
}) {
  return buildLifecyclePipeline({
    counts: args.counts === undefined ? counts() : args.counts,
    selectedState: args.selectedState ?? null,
    onSelectState: args.onSelectState ?? (() => {}),
  });
}

describe("lifecycle topology", () => {
  it("walks the spine in the order the machine allows", () => {
    expect(GUARANTEE_SPINE_STATES).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
    ]);

    for (let index = 1; index < GUARANTEE_SPINE_STATES.length; index += 1) {
      const from = GUARANTEE_SPINE_STATES[index - 1];
      const to = GUARANTEE_SPINE_STATES[index];
      expect(ALLOWED_TRANSITIONS[from]).toContain(to);
    }
  });

  it("sets the two states that end a guarantee apart from the spine", () => {
    expect(GUARANTEE_EXIT_STATES).toEqual(["in_eviction", "closed"]);
    expect(ALLOWED_TRANSITIONS.in_eviction).toEqual(["closed"]);
    expect(ALLOWED_TRANSITIONS.closed).toEqual([]);
  });

  it("accounts for every guarantee state exactly once", () => {
    expect([...GUARANTEE_SPINE_STATES, ...GUARANTEE_EXIT_STATES].sort()).toEqual(
      [...GUARANTEE_STATES].sort(),
    );
  });

  it("draws the cure return from every state that can go back to active", () => {
    for (const state of GUARANTEE_CURE_ORIGIN_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toContain(GUARANTEE_STATE.ACTIVE);
    }

    // `drafted -> active` also lands on active, but that edge is activation:
    // it runs forward along the spine and is already drawn as the arrow
    // between the first two nodes. A cure is a return, so it can only come
    // from a state that sits AFTER active.
    const activeIndex = GUARANTEE_SPINE_STATES.indexOf(GUARANTEE_STATE.ACTIVE);
    const everyCureOrigin = GUARANTEE_STATES.filter(
      (state) =>
        GUARANTEE_SPINE_STATES.indexOf(state) > activeIndex &&
        ALLOWED_TRANSITIONS[state].includes(GUARANTEE_STATE.ACTIVE),
    );
    expect([...GUARANTEE_CURE_ORIGIN_STATES].sort()).toEqual([...everyCureOrigin].sort());
  });
});

describe("buildLifecyclePipeline", () => {
  it("returns null while the counts are still loading", () => {
    expect(build({ counts: null })).toBeNull();
    expect(
      buildLifecyclePipeline({ counts: undefined, selectedState: null, onSelectState() {} }),
    ).toBeNull();
  });

  it("lands each state's count on its own node", () => {
    const pipeline = build({
      counts: counts({
        drafted: 3,
        active: 41,
        in_arrears: 7,
        default_verified: 2,
        cover_committed: 1,
        in_eviction: 4,
        closed: 18,
      }),
    });

    expect(pipeline?.spine.map((node) => [node.state, node.count])).toEqual([
      ["drafted", 3],
      ["active", 41],
      ["in_arrears", 7],
      ["default_verified", 2],
      ["cover_committed", 1],
    ]);
    expect(pipeline?.exits.map((node) => [node.state, node.count])).toEqual([
      ["in_eviction", 4],
      ["closed", 18],
    ]);
  });

  it("mutes a state holding nothing and leaves an occupied one at full strength", () => {
    const pipeline = build({ counts: counts({ active: 41, in_arrears: 0, closed: 6 }) });

    const empty = [...(pipeline?.spine ?? []), ...(pipeline?.exits ?? [])]
      .filter((node) => node.isEmpty)
      .map((node) => node.state);
    expect(empty).toEqual([
      "drafted",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);

    expect(pipeline?.spine.find((node) => node.state === "active")?.isEmpty).toBe(false);
    expect(pipeline?.exits.find((node) => node.state === "closed")?.isEmpty).toBe(false);
  });

  it("keeps a state at zero rather than dropping it from the picture", () => {
    const pipeline = build({ counts: counts() });
    expect(pipeline?.spine).toHaveLength(5);
    expect(pipeline?.exits).toHaveLength(2);
  });

  it("carries the state's tone colour as a css variable", () => {
    const pipeline = build({ counts: counts() });
    for (const node of pipeline?.spine ?? []) {
      expect(node.accentColor).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  it("emits the clicked state as the filter", () => {
    const onSelectState = vi.fn();
    const pipeline = build({ counts: counts({ in_arrears: 7 }), onSelectState });

    pipeline?.spine.find((node) => node.state === "in_arrears")?.select();
    expect(onSelectState).toHaveBeenCalledWith("in_arrears");

    pipeline?.exits.find((node) => node.state === "closed")?.select();
    expect(onSelectState).toHaveBeenLastCalledWith("closed");
  });

  it("clears the filter when the node already driving it is clicked again", () => {
    const onSelectState = vi.fn();
    const pipeline = build({
      counts: counts({ active: 41 }),
      selectedState: "active",
      onSelectState,
    });

    const active = pipeline?.spine.find((node) => node.state === "active");
    expect(active?.isSelected).toBe(true);
    active?.select();
    expect(onSelectState).toHaveBeenCalledWith(null);
  });

  it("marks only the selected state as selected", () => {
    const pipeline = build({ counts: counts(), selectedState: "in_eviction" });

    expect(pipeline?.exits.find((node) => node.state === "in_eviction")?.isSelected).toBe(true);
    expect(pipeline?.spine.every((node) => node.isSelected === false)).toBe(true);
  });
});
