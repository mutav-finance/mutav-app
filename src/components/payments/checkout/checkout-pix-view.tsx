"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import QRCode from "qrcode";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Mono } from "@/components/ui/mono";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useAnchorOnramp, type AnchorOnrampPhase } from "@/hooks/use-anchor-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

interface Props {
  paymentId: Id<"payments">;
  totalCents: number;
}

/**
 * Client island that drives the SEP-6 anchor flow on the PIX checkout
 * step. Auto-starts on mount; subscribes to the anchorOrders row via
 * useQuery (inside the hook); renders skeleton → QR + copy → terminal
 * state. The hook's poll loop tears down on unmount.
 */
export function CheckoutPixView({ paymentId, totalCents }: Props) {
  const t = useTranslations("checkout.pix");
  const locale = useLocale();
  const { phase, order, error, start, cancel, reset } = useAnchorOnramp({
    paymentId,
    startAction: api.anchors.actions.startPixOnramp,
    pollAction: api.anchors.actions.pollPixOnramp,
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
  if (phase === "idle" || phase === "starting" || !order)
    return <CheckoutSkeleton brl={formatBRLCents(totalCents)} message={t("status.preparing")} />;

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
  const t = useTranslations("checkout.pix");
  const pix = parsePixInstructions(order.instructions);

  return (
    <div className="flex flex-col gap-4">
      <AmountHero brl={formatBRLCents(totalCents)} />
      <PaymentQrCode value={pix.qrPayload} />
      {pix.copyValue && <CopyField label={t("copyCode")} value={pix.copyValue} />}
      <AwaitingStatus message={pixPhaseLabel(t, phase)} />
      {(pix.fields.length > 0 || order.how) && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 pt-1 text-[11px]"
            >
              {t("details")} <ChevronDown className="size-3" strokeWidth={1.5} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {pix.fields.length > 0 && (
              <dl className="border-border flex flex-col gap-2 border-t pt-3">
                {pix.fields.map((field) => (
                  <div key={field.key} className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground text-xs">
                      {field.description ?? field.key}
                    </dt>
                    <dd className="text-foreground max-w-[60%] text-right text-xs break-all">
                      <Mono>{field.value}</Mono>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {order.how && <p className="text-muted-foreground mt-2 text-xs">{order.how}</p>}
            <p className="text-muted-foreground mt-2 text-center font-mono text-[10px]">
              {t("orderId")}: {order._id.slice(-8)}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ─── Shared shell pieces ──────────────────────────────────────────────────────

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

function CheckoutSkeleton({ brl, message }: { brl: string; message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <AmountHero brl={brl} />
      <div className="flex justify-center">
        <div className="border-border bg-background inline-flex items-center justify-center border p-2">
          <Skeleton className="size-[200px] rounded-none" />
        </div>
      </div>
      <div className="border-border flex items-center gap-2 border p-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-3 w-full" />
        </div>
        <Skeleton className="size-8" />
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

function PaymentQrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#1A1A1A", light: "#FFFFFF" },
      width: 240,
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className="flex justify-center">
      <div className="border-border bg-background inline-flex items-center justify-center border p-2">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Pix QR" width={240} height={240} />
        ) : (
          <div className="bg-muted size-[240px] animate-pulse" />
        )}
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard("copied");
  return (
    <div className="border-border flex items-center gap-2 border p-2">
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
        <Mono className="text-foreground block truncate text-xs">{value}</Mono>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="size-8 shrink-0 p-0"
        onClick={() => copy(value)}
        aria-label={label}
      >
        {copied ? (
          <Check className="size-4" strokeWidth={1.25} />
        ) : (
          <Copy className="size-4" strokeWidth={1.25} />
        )}
      </Button>
    </div>
  );
}

// ─── Pix instructions parsing (file-private) ──────────────────────────────────

interface ParsedPixInstructions {
  qrPayload: string;
  copyValue: string | null;
  fields: Array<{ key: string; value: string; description: string }>;
}

function parsePixInstructions(
  instructions: Record<string, { value: string; description: string }> | null | undefined,
): ParsedPixInstructions {
  const entries = instructions ? Object.entries(instructions) : [];

  const findField = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
      if (hit) return { key: hit[0], value: hit[1].value, description: hit[1].description };
    }
    return null;
  };

  const qrField = findField("pix_qr_code", "pix_br_code", "br_code", "qr_code") ?? null;
  const copyField =
    findField("pix_copia_cola", "pix_copia_e_cola", "copia_e_cola", "pix_copy_paste") ?? qrField;

  const promoted = new Set<string>();
  if (qrField) promoted.add(qrField.key.toLowerCase());
  if (copyField) promoted.add(copyField.key.toLowerCase());

  const remaining = entries
    .filter(([key]) => !promoted.has(key.toLowerCase()))
    .map(([key, { value, description }]) => ({ key, value, description }));

  const qrPayload = qrField?.value ?? JSON.stringify(instructions ?? {});
  const copyValue = copyField?.value ?? qrField?.value ?? null;

  return { qrPayload, copyValue, fields: remaining };
}

function pixPhaseLabel(t: ReturnType<typeof useTranslations>, phase: AnchorOnrampPhase): string {
  switch (phase) {
    case "awaiting_payment":
      return t("status.awaitingPayment");
    case "processing":
      return t("status.processing");
    default:
      return t("status.preparing");
  }
}
