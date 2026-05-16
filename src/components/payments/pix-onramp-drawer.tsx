"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Mono } from "@/components/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { usePixOnramp, type PixOnrampPhase } from "@/hooks/use-pix-onramp";
import type { Doc, Id } from "@convex/_generated/dataModel";

interface PixOnrampDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: Id<"payments">;
}

/**
 * Bottom drawer that runs the SEP-6 deposit flow. Auto-starts when the
 * drawer opens; on success the user sees a Pix-shaped instructions panel
 * (QR + copy-paste field + key-value list) inside Mutav — no popup, no
 * external page.
 */
export function PixOnrampDrawer({ open, onOpenChange, paymentId }: PixOnrampDrawerProps) {
  const t = useTranslations("paymentDetails.methodCard.pix");
  const { phase, order, error, start, cancel, reset } = usePixOnramp({ paymentId });

  const startedRef = useRef(false);
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    if (!open) {
      startedRef.current = false;
      cancel();
      const id = setTimeout(reset, 300);
      return () => clearTimeout(id);
    }
  }, [open, start, cancel, reset]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>{t("dialogTitle")}</DrawerTitle>
            <DrawerDescription>{statusDescription(t, phase)}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4">
            {phase === "idle" || phase === "starting" ? (
              <StatusBlock t={t} phase={phase} />
            ) : phase === "failed" ? (
              <FailedBlock t={t} phase={phase} message={error} />
            ) : phase === "completed" ? (
              <StatusBlock t={t} phase={phase} />
            ) : (
              <AwaitingBlock t={t} phase={phase} order={order} />
            )}
          </div>

          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">
                {phase === "completed" ? t("close") : t("cancel")}
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function StatusBlock({
  t,
  phase,
}: {
  t: ReturnType<typeof useTranslations>;
  phase: PixOnrampPhase;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <StatusIcon phase={phase} />
      <p className="text-foreground text-sm font-medium">{statusLabel(t, phase)}</p>
    </div>
  );
}

function FailedBlock({
  t,
  phase,
  message,
}: {
  t: ReturnType<typeof useTranslations>;
  phase: PixOnrampPhase;
  message: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8">
      <StatusIcon phase={phase} />
      <p className="text-foreground text-sm font-medium">{statusLabel(t, phase)}</p>
      {message && (
        <p className="text-muted-foreground max-w-prose text-center text-xs">{message}</p>
      )}
    </div>
  );
}

function AwaitingBlock({
  t,
  phase,
  order,
}: {
  t: ReturnType<typeof useTranslations>;
  phase: PixOnrampPhase;
  order: Doc<"anchorOrders"> | null;
}) {
  const pix = useMemo(() => parsePixInstructions(order?.instructions), [order?.instructions]);

  if (!order) return <StatusBlock t={t} phase={phase} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/30 flex items-center justify-center gap-3 rounded-md border px-3 py-2">
        <Loader2 className="text-foreground size-4 animate-spin" strokeWidth={1.25} />
        <p className="text-foreground text-xs font-medium">{statusLabel(t, phase)}</p>
      </div>

      <PixQrCode value={pix.qrPayload} />

      {pix.copyValue && <CopyField label={t("copyCode")} value={pix.copyValue} />}

      {pix.fields.length > 0 && (
        <dl className="border-border flex flex-col gap-2 border-t pt-3">
          {pix.fields.map((field) => (
            <div key={field.key} className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground text-xs">{field.description ?? field.key}</dt>
              <dd className="text-foreground max-w-[60%] text-right text-xs break-all">
                <Mono>{field.value}</Mono>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {order.how && <p className="text-muted-foreground text-xs italic">{order.how}</p>}

      <p className="text-muted-foreground font-mono text-[10px]">
        {t("orderId")}: {order._id.slice(-8)}
      </p>
    </div>
  );
}

function PixQrCode({ value }: { value: string }) {
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
      <div className="border-border bg-background inline-flex items-center justify-center border p-3">
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
    <div className="border-border flex flex-col gap-1 rounded-md border p-3">
      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</p>
      <div className="flex items-center gap-2">
        <Mono className="text-foreground flex-1 text-xs break-all">{value}</Mono>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 shrink-0 p-0"
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
    </div>
  );
}

interface ParsedPixInstructions {
  /** What the QR encodes. For real Pix anchors this is the BR Code / EMV string; testanchor falls back to the JSON dump. */
  qrPayload: string;
  /** What the "Copia e Cola" copy field shows. May be null if no copy-paste payload is available. */
  copyValue: string | null;
  /** Remaining instruction fields rendered as a key/description/value list. */
  fields: Array<{ key: string; value: string; description: string }>;
}

/**
 * Render-friendly view over SEP-6 deposit `instructions`. Real Brazilian
 * Pix anchors typically expose `pix_qr_code` / `pix_copia_cola` / `pix_chave`
 * style fields; we detect any of those and promote them. For generic
 * anchors (like testanchor) we encode the whole JSON payload into the QR
 * — not scannable as Pix, but visually unambiguous in demos that
 * "this is where the QR would live."
 */
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
