"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckoutSteps,
  type CheckoutStepState,
} from "@/components/payments/checkout/checkout-steps";
import { useAnchorOnramp, type AnchorOnrampPhase } from "@/hooks/use-anchor-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

interface Props {
  paymentId: Id<"payments">;
  totalCents: number;
}

const POPUP_WINDOW_FEATURES = "width=500,height=800,scrollbars=yes,resizable=yes";
const POPUP_WINDOW_NAME = "mutav-anchor-deposit";

/**
 * Client island for the SEP-24 hosted-UI deposit flow ("AnchorTest" method).
 *
 * Why no iframe: virtually every anchor (testanchor, Etherfuse, Bitso, …) sets
 * `X-Frame-Options: DENY` on their hosted form to prevent clickjacking — the
 * iframe renders empty. Instead we launch the form in a popup window and keep
 * Mutav on screen as the live progress monitor, polling the anchor for status.
 */
export function CheckoutAnchorTestView({ paymentId, totalCents }: Props) {
  const t = useTranslations("checkout.anchortest");
  const { phase, order, error, start, cancel, reset } = useAnchorOnramp({
    paymentId,
    startAction: api.anchors.actions.startAnchorTestOnramp,
    pollAction: api.anchors.actions.pollAnchorTestOnramp,
  });

  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void start();
    }
    return () => {
      cancel();
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "failed") return <FailedBlock message={error ?? t("status.failed")} />;
  if (phase === "completed") return <CompletedBlock message={t("status.completed")} />;
  if (phase === "idle" || phase === "starting" || !order || !order.hostedUrl)
    return <CheckoutSkeleton brl={formatBRLCents(totalCents)} message={t("status.preparing")} />;

  return <ActivePanel order={order} totalCents={totalCents} phase={phase} />;
}

function ActivePanel({
  order,
  totalCents,
  phase,
}: {
  order: Doc<"anchorOrders">;
  totalCents: number;
  phase: AnchorOnrampPhase;
}) {
  const t = useTranslations("checkout.anchortest");
  const hostedUrl = order.hostedUrl ?? "";

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const openPopup = useCallback(() => {
    const win = window.open(hostedUrl, POPUP_WINDOW_NAME, POPUP_WINDOW_FEATURES);
    if (!win) {
      setPopupBlocked(true);
      return;
    }
    popupRef.current = win;
    setPopupBlocked(false);
    setPopupOpen(true);
    win.focus();
  }, [hostedUrl]);

  // Detect when the user closes the popup so we can re-surface the "open" CTA.
  useEffect(() => {
    if (!popupOpen) return;
    const id = window.setInterval(() => {
      if (popupRef.current?.closed) {
        popupRef.current = null;
        setPopupOpen(false);
        window.clearInterval(id);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [popupOpen]);

  // Close the popup automatically when the order reaches a terminal state.
  useEffect(() => {
    if (phase === "completed" || phase === "failed") {
      popupRef.current?.close();
    }
  }, [phase]);

  const userTransferred = phase === "processing" || phase === "completed";
  const step1State: CheckoutStepState = userTransferred ? "done" : "active";
  const step2State: CheckoutStepState =
    phase === "completed" ? "done" : userTransferred ? "active" : "pending";
  const step3State: CheckoutStepState = phase === "completed" ? "done" : "pending";

  const openLabel =
    popupOpen || userTransferred ? t("steps.openForm.reopen") : t("steps.openForm.open");
  const step1Caption = popupBlocked
    ? t("steps.openForm.popupBlocked")
    : popupOpen
      ? t("steps.openForm.popupOpen")
      : t("steps.openForm.caption");
  const step1Action = popupBlocked ? (
    <Button asChild size="sm" className="gap-2">
      <a href={hostedUrl} target="_blank" rel="noopener noreferrer">
        {openLabel}
        <ExternalLink className="size-4" strokeWidth={1.25} />
      </a>
    </Button>
  ) : (
    <Button size="sm" className="gap-2" onClick={openPopup}>
      {openLabel}
      <ExternalLink className="size-4" strokeWidth={1.25} />
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <AmountHero brl={formatBRLCents(totalCents)} />
      <div className="border-border border p-5">
        <p className="text-muted-foreground mb-4 font-mono text-[11px] tracking-[0.06em] uppercase">
          {t("stepsHeading")}
        </p>
        <CheckoutSteps
          steps={[
            {
              title: t("steps.openForm.title"),
              state: step1State,
              caption: step1Caption,
              action: step1Action,
            },
            {
              title: t("steps.awaiting.title"),
              state: step2State,
              caption: t("steps.awaiting.caption"),
            },
            { title: t("steps.done.title"), state: step3State },
          ]}
        />
      </div>
      <p className="text-muted-foreground text-center font-mono text-[10px]">
        {t("orderId")}: <Mono>{order._id.slice(-8)}</Mono>
      </p>
    </div>
  );
}

function AmountHero({ brl }: { brl: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 pb-1">
      <p className="text-foreground text-3xl font-medium tabular-nums md:text-4xl">{brl}</p>
    </div>
  );
}

function CheckoutSkeleton({ brl, message }: { brl: string; message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <AmountHero brl={brl} />
      <div className="border-border space-y-4 border p-5">
        <Skeleton className="h-3 w-20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="size-6 shrink-0 rounded-none" />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Skeleton className="h-3 w-2/3" />
              {i === 0 && <Skeleton className="h-8 w-32" />}
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-center text-[11px] tracking-wide uppercase">
        {message}
      </p>
    </div>
  );
}

function CompletedBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <CheckCircle2 className="text-foreground size-12" strokeWidth={1.25} />
      <p className="text-foreground text-sm font-medium tracking-wide uppercase">{message}</p>
    </div>
  );
}

function FailedBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <AlertCircle className="text-destructive size-12" strokeWidth={1.25} />
      <p className="text-foreground max-w-prose text-center text-xs">{message}</p>
    </div>
  );
}
