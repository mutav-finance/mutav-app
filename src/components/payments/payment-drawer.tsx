"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import QRCode from "qrcode";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Mono } from "@/components/ui/mono";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { usePixOnramp, type PixOnrampPhase } from "@/hooks/use-pix-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { brlCentsToAsset } from "@/lib/stellar/asset-format";
import { getActiveAssets } from "@/lib/stellar/assets";
import { getStellarNetwork } from "@/lib/stellar/network";
import { buildSep7PayUri } from "@/lib/stellar/sep7";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type StellarAsset = "XLM" | "USDC";

// ─── Stellar drawer (user has funds on a Stellar wallet) ──────────────────────

interface StellarPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicId: string;
  totalCents: number;
}

export function StellarPaymentDrawer({
  open,
  onOpenChange,
  publicId,
  totalCents,
}: StellarPaymentDrawerProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.stellar");
  const tShared = useTranslations("paymentDetails.methodCard.pay");
  const [tab, setTab] = useState<StellarAsset>("XLM");

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto flex w-full max-w-md flex-col">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t("title")}</DrawerTitle>
          </DrawerHeader>

          <div className="px-4 pb-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as StellarAsset)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="XLM">{t("tabs.xlm")}</TabsTrigger>
                <TabsTrigger value="USDC">{t("tabs.usdc")}</TabsTrigger>
              </TabsList>

              <TabsContent value="XLM">
                <StellarDirectPanel publicId={publicId} totalCents={totalCents} assetSymbol="XLM" />
              </TabsContent>

              <TabsContent value="USDC">
                <StellarDirectPanel
                  publicId={publicId}
                  totalCents={totalCents}
                  assetSymbol="USDC"
                />
              </TabsContent>
            </Tabs>
          </div>

          <DrawerFooter className="pt-2">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">
                {tShared("close")}
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function StellarDirectPanel({
  publicId,
  totalCents,
  assetSymbol,
}: {
  publicId: string;
  totalCents: number;
  assetSymbol: StellarAsset;
}) {
  const t = useTranslations("paymentDetails.methodCard.pay.stellar");
  const locale = useLocale();

  const payment = useQuery(api.payments.useCases.getPublicByPublicId, { publicId });
  const isPaid = payment?.state.kind === "paid";

  const network = getStellarNetwork();
  const asset = getActiveAssets(network).find((a) => a.symbol === assetSymbol) ?? null;

  const sep7 =
    asset && payment?.muxedAddress
      ? (() => {
          const amount = brlCentsToAsset(totalCents, asset, locale);
          return {
            amountDisplay: amount.display,
            sep7Uri: buildSep7PayUri({
              destination: payment.muxedAddress,
              amount: amount.canonical,
              assetCode: asset.symbol,
              assetIssuer: asset.issuer ?? undefined,
            }),
          };
        })()
      : null;

  if (isPaid) return <CompletedBlock message={t("status.completed")} />;
  if (!payment || !sep7) return <PaymentSkeleton message={t("status.preparing")} />;

  return (
    <div className="flex flex-col gap-3 pt-4">
      <AmountHero brl={formatBRLCents(totalCents)} asset={`${sep7.amountDisplay} ${assetSymbol}`} />
      <PaymentQrCode value={sep7.sep7Uri} />
      <CopyField label={t("copyLink")} value={sep7.sep7Uri} />
      <AwaitingStatus message={t("status.awaitingPayment")} />
    </div>
  );
}

// ─── Pix drawer (user has BRL in a bank account) ──────────────────────────────

interface PixPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: Id<"payments">;
}

export function PixPaymentDrawer({ open, onOpenChange, paymentId }: PixPaymentDrawerProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.pix");
  const tShared = useTranslations("paymentDetails.methodCard.pay");
  const { phase, order, error, start, cancel, reset } = usePixOnramp({ paymentId });

  const payment = useQuery(api.payments.useCases.getById, { paymentId });

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

  const pix = parsePixInstructions(order?.instructions);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto flex w-full max-w-md flex-col">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t("title")}</DrawerTitle>
          </DrawerHeader>

          <div className="px-4 pb-2">
            {phase === "completed" ? (
              <CompletedBlock message={t("status.completed")} />
            ) : phase === "failed" ? (
              <FailedBlock message={error ?? t("status.failed")} />
            ) : phase === "idle" || phase === "starting" || !order ? (
              <PaymentSkeleton message={t("status.preparing")} />
            ) : (
              <div className="flex flex-col gap-3">
                {payment && <AmountHero brl={formatBRLCents(payment.totalCents)} />}
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
                      {order.how && (
                        <p className="text-muted-foreground mt-2 text-xs italic">{order.how}</p>
                      )}
                      <p className="text-muted-foreground mt-2 text-center font-mono text-[10px]">
                        {t("orderId")}: {order._id.slice(-8)}
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>

          <DrawerFooter className="pt-2">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">
                {tShared("close")}
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ─── Shared shell pieces (file-private) ───────────────────────────────────────

function AmountHero({ brl, asset }: { brl: string; asset?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 pb-1">
      <p className="text-foreground text-2xl font-medium tabular-nums">{brl}</p>
      {asset && <p className="text-muted-foreground text-xs">≈ {asset}</p>}
    </div>
  );
}

function AwaitingStatus({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 pt-1">
      <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
      <p className="text-[11px]">{message}</p>
    </div>
  );
}

/**
 * Layout-matched skeleton — placeholders for each block in the loaded
 * drawer (amount + QR + copy field) so the drawer doesn't visibly jump
 * when the async data arrives. The status footer below the skeleton
 * stays real (spinner + live status message) so the user knows
 * something is happening rather than seeing a frozen placeholder.
 */
function PaymentSkeleton({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3 pt-4">
      <div className="flex flex-col items-center gap-0.5 pb-1">
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex justify-center">
        <div className="border-border bg-background inline-flex items-center justify-center border p-2">
          <Skeleton className="size-[200px] rounded-none" />
        </div>
      </div>
      <div className="border-border flex items-center gap-2 rounded-md border p-2">
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
      <p className="text-foreground text-sm font-medium">{message}</p>
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
      width: 200,
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
          <img src={dataUrl} alt="Payment QR" width={200} height={200} />
        ) : (
          <div className="bg-muted size-[200px] animate-pulse" />
        )}
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard("copied");
  return (
    <div className="border-border flex items-center gap-2 rounded-md border p-2">
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

function pixPhaseLabel(t: ReturnType<typeof useTranslations>, phase: PixOnrampPhase): string {
  switch (phase) {
    case "awaiting_payment":
      return t("status.awaitingPayment");
    case "processing":
      return t("status.processing");
    default:
      return t("status.preparing");
  }
}
