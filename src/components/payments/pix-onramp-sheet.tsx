"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePixOnramp, type PixOnrampPhase } from "@/hooks/use-pix-onramp";
import type { Id } from "@convex/_generated/dataModel";

interface PixOnrampSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: Id<"payments">;
}

/**
 * Slide-in panel that runs the SEP-24 deposit flow. Auto-starts when the
 * sheet opens (so the hosted URL is ready ASAP) and tears down polling
 * when the sheet closes.
 */
export function PixOnrampSheet({ open, onOpenChange, paymentId }: PixOnrampSheetProps) {
  const t = useTranslations("paymentDetails.methodCard.pix");
  const { phase, hostedUrl, order, error, start, cancel, reset } = usePixOnramp({ paymentId });

  // Auto-start when the sheet opens; cancel polling when it closes.
  const startedRef = useRef(false);
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    if (!open) {
      startedRef.current = false;
      cancel();
      // Defer reset so the closing animation doesn't flash an empty state.
      const id = setTimeout(reset, 200);
      return () => clearTimeout(id);
    }
  }, [open, start, cancel, reset]);

  // When the hosted URL arrives and the popup hasn't been opened yet, open it.
  const popupOpenedRef = useRef(false);
  useEffect(() => {
    if (open && hostedUrl && !popupOpenedRef.current) {
      popupOpenedRef.current = true;
      openHostedFlow(hostedUrl);
    }
    if (!open) popupOpenedRef.current = false;
  }, [open, hostedUrl]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("dialogTitle")}</SheetTitle>
          <SheetDescription>{statusDescription(t, phase)}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-8">
          <StatusIcon phase={phase} />
          <p className="text-foreground text-center text-sm font-medium">{statusLabel(t, phase)}</p>

          {phase === "failed" && error && (
            <p className="text-destructive max-w-prose text-center text-xs">{error}</p>
          )}

          {phase === "awaiting_payment" && hostedUrl && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={hostedUrl} target="_blank" rel="noopener">
                {t("openHostedFlow")}
                <ExternalLink className="size-4" strokeWidth={1.25} />
              </a>
            </Button>
          )}

          {order && (
            <p className="text-muted-foreground font-mono text-[10px]">
              {t("orderId")}: {order._id.slice(-8)}
            </p>
          )}
        </div>

        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline" className="w-full">
              {phase === "completed" ? t("close") : t("cancel")}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function openHostedFlow(url: string): void {
  const width = 500;
  const height = 800;
  const left = window.screenX + (window.innerWidth - width) / 2;
  const top = window.screenY + (window.innerHeight - height) / 2;
  const popup = window.open(
    url,
    "mutav-anchor-onramp",
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
  // If the popup was blocked, fall back to a same-tab navigation — not ideal,
  // but better than silently failing.
  if (!popup) window.open(url, "_blank", "noopener,noreferrer");
}

function StatusIcon({ phase }: { phase: PixOnrampPhase }) {
  switch (phase) {
    case "completed":
      return <CheckCircle2 className="text-foreground size-12" strokeWidth={1.25} />;
    case "failed":
      return <AlertCircle className="text-destructive size-12" strokeWidth={1.25} />;
    default:
      return <Loader2 className="text-foreground size-12 animate-spin" strokeWidth={1.25} />;
  }
}

function statusLabel(t: ReturnType<typeof useTranslations>, phase: PixOnrampPhase): string {
  switch (phase) {
    case "idle":
    case "starting":
      return t("status.starting");
    case "awaiting_payment":
      return t("status.awaitingPayment");
    case "processing":
      return t("status.processing");
    case "completed":
      return t("status.completed");
    case "failed":
      return t("status.failed");
  }
}

function statusDescription(t: ReturnType<typeof useTranslations>, phase: PixOnrampPhase): string {
  if (phase === "completed") return t("description.completed");
  if (phase === "failed") return t("description.failed");
  return t("description.default");
}
