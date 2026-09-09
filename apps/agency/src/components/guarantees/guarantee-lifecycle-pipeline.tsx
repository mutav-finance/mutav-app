"use client";

import { Fragment } from "react";
import { ArrowUpIcon, ChevronRightIcon } from "lucide-react";
import type { GuaranteeState } from "@convex/guarantees/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { cn } from "@mutav/ui/cn";
import { Skeleton } from "@mutav/ui/skeleton";
import {
  useGuaranteeLifecyclePipeline,
  type LifecycleNode,
} from "@/components/guarantees/use-guarantee-lifecycle-pipeline";
import type { GuaranteeStateCounts } from "@/lib/guarantees/state-chart";

type GuaranteeLifecyclePipelineProps = {
  counts: GuaranteeStateCounts | null | undefined;
  selectedState: GuaranteeState | null;
  onSelectState: (state: GuaranteeState | null) => void;
};

const SPINE_SKELETON_COUNT = 5;

/**
 * Where the agency's book actually sits, on the topology the machine enforces.
 *
 * This is the live reading of `convex/guarantees/machine.ts`, not a teaching
 * diagram: the count is the figure, the state is the caption, and a state
 * holding nothing recedes so the occupied ones carry the story. The
 * documentation diagram at `docs/architecture/guarantee-lifecycle.html` keeps
 * the actors and the per-edge detail — that belongs in a doc read once, not in
 * a card read every morning.
 *
 * Layout: the spine sits on one line from `@48rem` and stacks below it, so
 * five nodes and four connectors never truncate a state name and the card
 * never scrolls sideways. Every container-query prefix is written out in full
 * — Tailwind scans source text, so a prefix assembled from a constant compiles
 * to nothing and the breakpoint silently never fires.
 *
 * Colour comes from the same tone map the status tags use, so a state is one
 * colour everywhere on the page. Two pairs collapse there and collapse here
 * (`default_verified`/`cover_committed`, `drafted`/`closed`); position and
 * label disambiguate them, and nothing is carried by colour alone.
 */
export function GuaranteeLifecyclePipeline({
  counts,
  selectedState,
  onSelectState,
}: GuaranteeLifecyclePipelineProps) {
  const pipeline = useGuaranteeLifecyclePipeline({ counts, selectedState, onSelectState });

  return (
    <Card className="@container/lifecycle">
      <CardHeader>
        <CardDescription>{pipeline.description}</CardDescription>
        <CardTitle>{pipeline.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {pipeline.spine === null || pipeline.exits === null ? (
          <PipelineSkeleton />
        ) : (
          <>
            <div role="group" aria-label={pipeline.spineLabel}>
              {/* `node, connector, node, …`: the connectors take their natural
                  width and the five nodes split the rest evenly, which is what
                  lets the cure return span an exact range of columns below. */}
              <div className="grid gap-1.5 @[48rem]/lifecycle:grid-cols-[repeat(4,minmax(0,1fr)_auto)_minmax(0,1fr)]">
                {pipeline.spine.map((node, index) => (
                  <Fragment key={node.state}>
                    {index > 0 ? <Connector /> : null}
                    <LifecycleNodeButton
                      node={node}
                      label={pipeline.stateLabel(node.state)}
                      ariaLabel={pipeline.nodeAriaLabel(node)}
                    />
                  </Fragment>
                ))}
                <CureReturn label={pipeline.cureLabel} />
              </div>
              <p className="text-muted-foreground/70 mt-2 text-[11px] @[48rem]/lifecycle:hidden">
                {pipeline.cureLabel}
              </p>
            </div>

            <div
              role="group"
              aria-label={pipeline.exitsLabel}
              className="border-border/60 mt-5 border-t border-dashed pt-4"
            >
              <p className="text-muted-foreground/70 mb-2 text-[11px] font-medium tracking-wide uppercase">
                {pipeline.exitsLabel}
              </p>
              <div className="grid max-w-lg gap-1.5 @[48rem]/lifecycle:grid-cols-2">
                {pipeline.exits.map((node) => (
                  <LifecycleNodeButton
                    key={node.state}
                    node={node}
                    label={pipeline.stateLabel(node.state)}
                    ariaLabel={pipeline.nodeAriaLabel(node)}
                    className="border-dashed"
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LifecycleNodeButton({
  node,
  label,
  ariaLabel,
  className,
}: {
  node: LifecycleNode;
  label: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={node.select}
      aria-pressed={node.isSelected}
      aria-label={ariaLabel}
      className={cn(
        "hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px]",
        // An empty state has to lose the card, not just dim its numeral:
        // keeping the same filled surface and full-strength border made
        // `0 Em despejo` read at the same weight as `1 Encerrada`.
        node.isEmpty ? "border-border/40 bg-transparent" : "bg-card",
        node.isSelected && "border-primary/60 bg-accent/40",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-9 w-1 shrink-0 rounded-full", node.isEmpty && "opacity-15")}
        style={{ backgroundColor: node.accentColor }}
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-xl leading-none font-semibold tabular-nums",
            node.isEmpty ? "text-muted-foreground/45" : "text-foreground",
          )}
        >
          {node.count}
        </span>
        <span
          className={cn(
            "mt-1 text-xs leading-tight",
            node.isEmpty ? "text-muted-foreground/45" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

/** Points along the spine on one line, and down the spine once it stacks. */
function Connector() {
  return (
    <span aria-hidden className="text-muted-foreground/50 flex items-center justify-center py-0.5">
      <ChevronRightIcon className="size-4 rotate-90 @[48rem]/lifecycle:rotate-0" />
    </span>
  );
}

/**
 * The three cure edges as one bracket rather than three arcs, spanning from
 * `cover_committed`'s column back to `active`'s. A tenant can regularise from
 * arrears, from a verified default or after cover was committed, and all three
 * land back on `active` — drawing them separately spends the reader's
 * attention on a path that is context, not the message. Hidden once the spine
 * stacks, where a sentence carries it instead.
 *
 * Both ends are terminated and inset. Drawn flush to the grid columns the
 * bracket spans, its right edge landed on the card's own edge and read as a
 * dashed line running off the card from nowhere; the arrowhead, overlapping
 * the vertical it sat on, read as a stray tick. So: a dot marks the origin
 * under `cover_committed`, an arrowhead marks the target under `active`, and
 * the arrow occupies the padding band above the line instead of crossing it.
 */
function CureReturn({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      className="hidden @[48rem]/lifecycle:[grid-column:3/10] @[48rem]/lifecycle:block"
    >
      {/* `pt-3.5` is the arrowhead's own band — it matches `size-3.5` so the
          arrow sits above the line rather than across it, and `top-3.5` puts
          the origin dot exactly on the right vertical's top edge. */}
      <div className="relative mx-6 pt-3.5">
        <div className="border-muted-foreground/40 h-2.5 rounded-b-md border-x border-b border-dashed" />
        <ArrowUpIcon
          className="text-muted-foreground/70 absolute top-0 left-0 size-3.5 -translate-x-1/2"
          strokeWidth={2.5}
        />
        <span className="bg-muted-foreground/60 absolute top-3.5 right-0 size-1.5 translate-x-1/2 -translate-y-1/2 rounded-full" />
      </div>
      <p className="text-muted-foreground/70 mt-1 text-center text-[11px]">{label}</p>
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="grid gap-1.5 @[48rem]/lifecycle:grid-cols-5">
      {Array.from({ length: SPINE_SKELETON_COUNT }, (_, index) => (
        <Skeleton key={index} className="h-[62px] w-full" />
      ))}
    </div>
  );
}
