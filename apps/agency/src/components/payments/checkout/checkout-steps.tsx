"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckoutStepState = "pending" | "active" | "done";

interface CheckoutStep {
  title: string;
  /** Optional caption shown beneath the title when the step is active. */
  caption?: string;
  /** Optional inline action node rendered beneath the title (CTA, link). */
  action?: React.ReactNode;
  state: CheckoutStepState;
}

/**
 * Numbered step list used by checkout flows that hand off to an external
 * surface (e.g. SEP-24 hosted UI in a popup). Each step is one of three
 * states: pending (gray), active (amber square + caption + optional CTA),
 * done (filled square + check). The component is presentational — the
 * parent owns phase derivation and CTA wiring.
 */
export function CheckoutSteps({ steps }: { steps: CheckoutStep[] }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Checkout progress">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-3">
          <StepMarker index={index + 1} state={step.state} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
            <p
              className={cn(
                "text-sm font-medium tracking-tight",
                step.state === "pending" && "text-muted-foreground",
                step.state === "done" && "text-muted-foreground line-through",
                step.state === "active" && "text-foreground",
              )}
            >
              {step.title}
            </p>
            {step.state === "active" && step.caption && (
              <p className="text-muted-foreground text-xs">{step.caption}</p>
            )}
            {step.state === "active" && step.action && <div className="pt-1">{step.action}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMarker({ index, state }: { index: number; state: CheckoutStepState }) {
  if (state === "done") {
    return (
      <div
        aria-hidden
        className="border-foreground bg-foreground text-background flex size-6 shrink-0 items-center justify-center border"
      >
        <Check className="size-3" strokeWidth={2} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div
        aria-hidden
        className="border-foreground text-foreground bg-accent flex size-6 shrink-0 items-center justify-center border font-mono text-xs"
      >
        {index}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="border-border text-muted-foreground flex size-6 shrink-0 items-center justify-center border font-mono text-xs"
    >
      {index}
    </div>
  );
}
