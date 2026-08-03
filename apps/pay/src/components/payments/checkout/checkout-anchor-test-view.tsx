"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { AmountHero, CompletedBlock, FailedBlock } from "./checkout-blocks";

import { Button } from "@mutav/ui/button";
import { Mono } from "@mutav/ui/mono";
import { Skeleton } from "@mutav/ui/skeleton";
import {
  CheckoutSteps,
  type CheckoutStepState,
} from "@/components/payments/checkout/checkout-steps";
import { useAnchorOnramp, type AnchorOnrampPhase } from "@/hooks/use-anchor-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";
import type { ProviderOrder } from "@convex/payments/providers/orderDomain";

interface Props {
  invoiceAccessToken: string;
  totalCents: number;
}

const POPUP_WINDOW_NAME = "mutav-anchor-deposit";

/**
 * Client island for the SEP-24 hosted-UI deposit flow ("AnchorTest" method).
 *
 * Why no iframe: virtually every anchor (testanchor, Etherfuse, Bitso, …) sets
 * `X-Frame-Options: DENY` on their hosted form to prevent clickjacking — the
 * iframe renders empty. Instead we launch the form in a popup window and keep
 * Mutav on screen as the live progress monitor, polling the anchor for status.
 */
export function CheckoutAnchorTestView({ invoiceAccessToken, totalCents }: Props) {
  const t = useTranslations("checkout.anchortest");
  const locale = useLocale();
  const { phase, order, error, start, cancel, reset } = useAnchorOnramp({
    invoiceAccessToken,
    startAction: api.payments.providers.actions.startAnchorTestOnramp,
    pollAction: api.payments.providers.actions.pollAnchorTestOnramp,
    lang: locale,
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

  if (phase === "failed") {
    const errorMessage = error ? t(`errors.${error.code}` as const) : t("status.failed");
    return <FailedBlock message={errorMessage} />;
  }
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
  order: ProviderOrder;
  totalCents: number;
  phase: AnchorOnrampPhase;
}) {
  const t = useTranslations("checkout.anchortest");
  const hostedUrl = order.hostedUrl ?? "";

  const [popupOpen, setPopupOpen] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const openPopup = useCallback(() => {
    // No window features → browser opens as a regular new tab/window,
    // not a constrained popup. Reusing the same window name means
    // re-clicking re-focuses the existing tab instead of spawning a new one.
    const win = window.open(hostedUrl, POPUP_WINDOW_NAME);
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
