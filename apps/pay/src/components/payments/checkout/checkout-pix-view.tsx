"use client";

import { Suspense, use, useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAction, useQuery } from "convex/react";
import QRCode from "qrcode";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ExternalLink,
  RefreshCcw,
  Plus,
} from "lucide-react";

import { Button } from "@mutav/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@mutav/ui/collapsible";
import { Mono } from "@mutav/ui/mono";
import { Skeleton } from "@mutav/ui/skeleton";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useAnchorOnramp, type AnchorOnrampPhase } from "@/hooks/use-anchor-onramp";
import { formatBRLCents } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import type {
  AgencyBankAccount,
  AgencyBankAccountId,
} from "@convex/payments/providers/bankAccountDomain";
import type { AnchorOrder } from "@convex/payments/providers/orderDomain";
import type { InvoiceId } from "@convex/invoices/domain";

interface Props {
  invoiceId: InvoiceId;
  invoicePublicId: string;
  agencyId: AgencyId;
  totalCents: number;
}

/**
 * Client island for the Pix checkout step. Two phases:
 *
 *   pre-flight — surface the agency's registered bank accounts, gate
 *     payment initiation on at least one bank existing. Empty list →
 *     register-a-bank CTA (opens Etherfuse hosted UI in a new tab).
 *   on-ramp — the existing start → poll → QR + copy → terminal flow,
 *     parameterized by the bank account the operator picked.
 *
 * Etherfuse needs a registered debit-side bank for every order; without
 * one we'd get an opaque "Proxy account not found" from their API.
 * Gating up front makes the requirement legible to the operator.
 */
export function CheckoutPixView({ invoiceId, invoicePublicId, agencyId, totalCents }: Props) {
  const t = useTranslations("checkout.pix");
  const locale = useLocale();
  const banks = useQuery(api.payments.providers.bankAccountUseCases.listBanksForInvoice, {
    invoicePublicId,
  });
  const [started, setStarted] = useState(false);
  const { phase, order, error, start, cancel, reset } = useAnchorOnramp({
    invoiceId,
    startAction: api.payments.providers.actions.startPixOnramp,
    pollAction: api.payments.providers.actions.pollPixOnramp,
    lang: locale,
  });

  // Cleanup runs once on unmount. `useEffectEvent` decouples the latest
  // cancel/reset references from the effect's dep array so we don't
  // re-run the effect (and re-arm the cleanup) whenever the on-ramp
  // hook re-renders.
  const onUnmount = useEffectEvent(() => {
    cancel();
    reset();
  });
  useEffect(() => {
    return () => onUnmount();
  }, []);

  const handleConfirm = useCallback(
    (bankAccountId: AgencyBankAccountId) => {
      setStarted(true);
      void start({ bankAccountId });
    },
    [start],
  );

  if (!started) {
    return <PreFlight agencyId={agencyId} banks={banks} onConfirm={handleConfirm} />;
  }

  if (phase === "failed") {
    const errorMessage = error ? t(`errors.${error.code}` as const) : t("status.failed");
    return <FailedBlock message={errorMessage} />;
  }
  if (phase === "completed") return <CompletedBlock message={t("status.completed")} />;
  if (phase === "idle" || phase === "starting" || !order)
    return <CheckoutSkeleton brl={formatBRLCents(totalCents)} message={t("status.preparing")} />;

  return <LoadedPanel order={order} totalCents={totalCents} phase={phase} />;
}

// ─── Pre-flight: bank registration + selection ────────────────────────────────

function PreFlight({
  agencyId,
  banks,
  onConfirm,
}: {
  agencyId: AgencyId;
  banks: AgencyBankAccount[] | undefined;
  onConfirm: (bankAccountId: AgencyBankAccountId) => void;
}) {
  const t = useTranslations("checkout.pix.bankSelection");
  const getRegistrationUrl = useAction(
    api.payments.providers.actions.getEtherfuseBankRegistrationUrl,
  );
  const sync = useAction(api.payments.providers.actions.syncEtherfuseBankAccounts);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<AgencyBankAccountId | null>(null);

  const handleAdd = useCallback(async () => {
    setActionError(null);
    setAdding(true);
    try {
      const result = await getRegistrationUrl({ agencyId });
      if (result.success) {
        window.open(result.data.presignedUrl, "_blank", "noopener,noreferrer");
      } else {
        setActionError(t(`errors.${result.error.code}` as const));
        setAdding(false);
      }
    } catch (err) {
      setActionError(t("errors.INTERNAL"));
      setAdding(false);
      console.warn("[checkout-pix] getRegistrationUrl failed", err);
    }
  }, [agencyId, getRegistrationUrl, t]);

  const handleRefresh = useCallback(async () => {
    setActionError(null);
    setRefreshing(true);
    try {
      const result = await sync({ agencyId });
      if (!result.success) {
        setActionError(t(`errors.${result.error.code}` as const));
      } else {
        setAdding(false);
      }
    } catch (err) {
      setActionError(t("errors.INTERNAL"));
      console.warn("[checkout-pix] syncEtherfuseBankAccounts failed", err);
    } finally {
      setRefreshing(false);
    }
  }, [agencyId, sync, t]);

  if (banks === undefined) {
    return <PreFlightSkeleton message={t("loading")} />;
  }

  if (banks.length === 0) {
    return (
      <BanksEmptyState
        adding={adding}
        refreshing={refreshing}
        error={actionError}
        onAdd={handleAdd}
        onRefresh={handleRefresh}
      />
    );
  }

  const effectiveSelected = selectedId ?? banks[0]!._id;
  return (
    <BankPicker
      banks={banks}
      selectedId={effectiveSelected}
      onSelect={setSelectedId}
      onConfirm={() => onConfirm(effectiveSelected)}
      adding={adding}
      refreshing={refreshing}
      error={actionError}
      onAdd={handleAdd}
      onRefresh={handleRefresh}
    />
  );
}

function PreFlightSkeleton({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <div className="text-muted-foreground flex items-center justify-center gap-2 pt-1">
        <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
        <p className="text-[11px] tracking-wide uppercase">{message}</p>
      </div>
    </div>
  );
}

function BanksEmptyState({
  adding,
  refreshing,
  error,
  onAdd,
  onRefresh,
}: {
  adding: boolean;
  refreshing: boolean;
  error: string | null;
  onAdd: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("checkout.pix.bankSelection");
  return (
    <div className="border-border flex flex-col gap-4 border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">{t("emptyTitle")}</p>
        <p className="text-muted-foreground text-xs">{t("emptyBody")}</p>
      </div>
      {adding ? <p className="text-muted-foreground text-xs">{t("addingBankHint")}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={onAdd} disabled={refreshing} className="flex-1">
          <ExternalLink className="size-4" strokeWidth={1.5} />
          {t("addBankButton")}
        </Button>
        {adding ? (
          <Button onClick={onRefresh} disabled={refreshing} variant="secondary" className="flex-1">
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <RefreshCcw className="size-4" strokeWidth={1.5} />
            )}
            {t("refreshButton")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function BankPicker({
  banks,
  selectedId,
  onSelect,
  onConfirm,
  adding,
  refreshing,
  error,
  onAdd,
  onRefresh,
}: {
  banks: AgencyBankAccount[];
  selectedId: AgencyBankAccountId;
  onSelect: (id: AgencyBankAccountId) => void;
  onConfirm: () => void;
  adding: boolean;
  refreshing: boolean;
  error: string | null;
  onAdd: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslations("checkout.pix.bankSelection");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-foreground text-sm font-medium">{t("picker.title")}</p>
      <ul className="flex flex-col gap-2">
        {banks.map((bank) => {
          const isSelected = bank._id === selectedId;
          return (
            <li key={bank._id}>
              <button
                type="button"
                onClick={() => onSelect(bank._id)}
                aria-pressed={isSelected}
                className={`border-border hover:bg-muted/40 flex w-full flex-col items-start gap-1 border p-3 text-left transition ${
                  isSelected ? "border-foreground bg-muted/40" : ""
                }`}
              >
                <span className="text-foreground text-sm">
                  {t("picker.holderLabel", { name: bank.accountHolderName || "—" })}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("picker.keyLabel", { last4: last4Of(bank.accountNumber) })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? <p className="text-muted-foreground text-xs">{t("addingBankHint")}</p> : null}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button onClick={onConfirm} disabled={refreshing}>
          {t("picker.payWithButton")}
        </Button>
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onAdd}
            disabled={refreshing}
            className="hover:text-foreground inline-flex items-center gap-1"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            {t("picker.addAnotherButton")}
          </button>
          {adding ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="hover:text-foreground inline-flex items-center gap-1"
            >
              {refreshing ? (
                <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
              ) : (
                <RefreshCcw className="size-3" strokeWidth={1.5} />
              )}
              {t("refreshButton")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function last4Of(value: string): string {
  if (!value) return "—";
  return value.length <= 4 ? value : value.slice(-4);
}

function LoadedPanel({
  order,
  totalCents,
  phase,
}: {
  order: AnchorOrder;
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
  const dataUrlPromise = useMemo(
    () =>
      QRCode.toDataURL(value, {
        errorCorrectionLevel: "M",
        margin: 1,
        color: { dark: "#1A1A1A", light: "#FFFFFF" },
        width: 240,
      }).catch(() => null),
    [value],
  );

  return (
    <div className="flex justify-center">
      <div className="border-border bg-background inline-flex items-center justify-center border p-2">
        <Suspense fallback={<div className="bg-muted size-[240px] animate-pulse" />}>
          <PaymentQrImage promise={dataUrlPromise} />
        </Suspense>
      </div>
    </div>
  );
}

function PaymentQrImage({ promise }: { promise: Promise<string | null> }) {
  const dataUrl = use(promise);
  if (!dataUrl) return <div className="bg-muted size-[240px] animate-pulse" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="Pix QR" width={240} height={240} />;
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
