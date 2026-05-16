"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnchorOnramp, type AnchorOnrampPhase } from "@/hooks/use-anchor-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

interface Props {
  paymentId: Id<"payments">;
  totalCents: number;
}

/**
 * Client island for the SEP-24 hosted-UI deposit flow ("AnchorTest" method).
 * Auto-starts on mount, embeds the anchor's hosted form as an iframe, and
 * subscribes to the order row for status updates. Distinct from the Pix
 * view, which renders SEP-6 instructions inline (no hand-off to the
 * anchor's UI).
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
    return <Skeleton_ brl={formatBRLCents(totalCents)} message={t("status.preparing")} />;

  return <LoadedPanel order={order} totalCents={totalCents} phase={phase} />;
}

function LoadedPanel({
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

  return (
    <div className="flex flex-col gap-4">
      <AmountHero brl={formatBRLCents(totalCents)} />

      <div className="border-border overflow-hidden border">
        <iframe
          src={hostedUrl}
          title={t("iframeTitle")}
          className="block h-[600px] w-full"
          allow="camera; microphone"
        />
      </div>

      <Button asChild size="sm" variant="outline" className="gap-2 self-center">
        <a href={hostedUrl} target="_blank" rel="noopener noreferrer">
          {t("openInNewTab")}
          <ExternalLink className="size-4" strokeWidth={1.25} />
        </a>
      </Button>

      <AwaitingStatus message={anchorTestPhaseLabel(t, phase)} />

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

function AwaitingStatus({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 pt-1">
      <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
      <p className="text-[11px] tracking-wide uppercase">{message}</p>
    </div>
  );
}

function Skeleton_({ brl, message }: { brl: string; message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <AmountHero brl={brl} />
      <div className="border-border border">
        <Skeleton className="h-[600px] w-full rounded-none" />
      </div>
      <AwaitingStatus message={message} />
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

function anchorTestPhaseLabel(
  t: ReturnType<typeof useTranslations>,
  phase: AnchorOnrampPhase,
): string {
  switch (phase) {
    case "awaiting_payment":
      return t("status.awaitingPayment");
    case "processing":
      return t("status.processing");
    default:
      return t("status.preparing");
  }
}
