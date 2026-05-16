"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { usePixOnramp, type PixOnrampPhase } from "@/hooks/use-pix-onramp";
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

/**
 * Drawer for users paying from a Stellar wallet (XLM or USDC). The asset
 * tabs are an asset choice WITHIN the Stellar funding source, not a
 * separate payment method. SEP-7 QR + copy fields + reactive status
 * (driven by the existing Horizon indexer flipping payment.state).
 */
export function StellarPaymentDrawer({
  open,
  onOpenChange,
  publicId,
  totalCents,
}: StellarPaymentDrawerProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.stellar");
  const [tab, setTab] = useState<StellarAsset>("XLM");

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>{t("title")}</DrawerTitle>
            <DrawerDescription>{t("description")}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4">
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

          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">
                {useTranslations("paymentDetails.methodCard.pay")("close")}
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
            amountCanonical: amount.canonical,
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
  if (!payment || !sep7) return <LoadingBlock message={t("status.preparing")} />;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <StatusBanner
        icon={<Loader2 className="text-foreground size-4 animate-spin" strokeWidth={1.25} />}
        text={t("status.awaitingPayment", { amount: sep7.amountDisplay, asset: assetSymbol })}
      />
      <PaymentQrCode value={sep7.sep7Uri} />
      <CopyField label={t("copyAddress")} value={payment.muxedAddress!} />
      <CopyField label={t("copySep7")} value={sep7.sep7Uri} />
      <p className="text-muted-foreground text-center text-xs">
        {t("hint", { amount: sep7.amountDisplay, asset: assetSymbol })}
      </p>
    </div>
  );
}

// ─── Pix drawer (user has BRL in a bank account) ──────────────────────────────

interface PixPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: Id<"payments">;
}

/**
 * Drawer for users paying via PIX from their bank app. Runs the SEP-6
 * anchor on-ramp (testanchor stages with SEPA-shaped mocks today;
 * Etherfuse will deliver real BR Code via the same flow once added to
 * the registry).
 */
export function PixPaymentDrawer({ open, onOpenChange, paymentId }: PixPaymentDrawerProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.pix");
  const tShared = useTranslations("paymentDetails.methodCard.pay");
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

  const pix = parsePixInstructions(order?.instructions);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader>
            <DrawerTitle>{t("title")}</DrawerTitle>
            <DrawerDescription>{t("description")}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4">
            {phase === "completed" ? (
              <CompletedBlock message={t("status.completed")} />
            ) : phase === "failed" ? (
              <FailedBlock message={error ?? t("status.failed")} />
            ) : phase === "idle" || phase === "starting" || !order ? (
              <LoadingBlock message={t("status.preparing")} />
            ) : (
              <div className="flex flex-col gap-4 pt-2">
                <StatusBanner
                  icon={
                    <Loader2 className="text-foreground size-4 animate-spin" strokeWidth={1.25} />
                  }
                  text={pixPhaseLabel(t, phase)}
                />
                <PaymentQrCode value={pix.qrPayload} />
                {pix.copyValue && <CopyField label={t("copyCode")} value={pix.copyValue} />}
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
                {order.how && <p className="text-muted-foreground text-xs italic">{order.how}</p>}
                <p className="text-muted-foreground text-center font-mono text-[10px]">
                  {t("orderId")}: {order._id.slice(-8)}
                </p>
              </div>
            )}
          </div>

          <DrawerFooter>
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

function StatusBanner({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="bg-muted/30 flex items-center justify-center gap-3 rounded-md border px-3 py-2">
      {icon}
      <p className="text-foreground text-xs font-medium">{text}</p>
    </div>
  );
}

function LoadingBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <Loader2 className="text-foreground size-12 animate-spin" strokeWidth={1.25} />
      <p className="text-foreground text-sm font-medium">{message}</p>
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
      <p className="text-foreground text-sm font-medium">{message}</p>
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
      <div className="border-border bg-background inline-flex items-center justify-center border p-3">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Payment QR" width={240} height={240} />
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
