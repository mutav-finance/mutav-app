"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { Copy, Check, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

type PixAnchorQrProps = {
  pixCode: string;
  expiresAt: string;
  onRegenerate: () => Promise<void> | void;
};

const QR_SIZE_PX = 192;
const CODE_PREFIX_CHARS = 12;
const CODE_SUFFIX_CHARS = 12;
const COUNTDOWN_TICK_MS = 1000;

function truncateCode(code: string): string {
  if (code.length <= CODE_PREFIX_CHARS + CODE_SUFFIX_CHARS + 1) return code;
  return `${code.slice(0, CODE_PREFIX_CHARS)}…${code.slice(-CODE_SUFFIX_CHARS)}`;
}

function computeSecondsRemaining(isoTimestamp: string): number {
  const expiry = new Date(isoTimestamp).getTime();
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, Math.floor((expiry - Date.now()) / 1000));
}

function useSecondsUntil(isoTimestamp: string): number {
  const [secondsRemaining, setSecondsRemaining] = React.useState<number>(() =>
    computeSecondsRemaining(isoTimestamp),
  );

  React.useEffect(() => {
    const interval = setInterval(() => {
      setSecondsRemaining(computeSecondsRemaining(isoTimestamp));
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [isoTimestamp]);

  return secondsRemaining;
}

export function PixAnchorQr({ pixCode, expiresAt, onRegenerate }: PixAnchorQrProps) {
  const t = useTranslations("paymentDetails.methodCard");
  const { copied, copy } = useCopyToClipboard(t("pixAnchorCopied"));
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [showFullCode, setShowFullCode] = React.useState(false);
  const [isRegenerating, setIsRegenerating] = React.useState(false);

  const secondsRemaining = useSecondsUntil(expiresAt);
  const isExpired = secondsRemaining <= 0;

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(pixCode, { width: QR_SIZE_PX, margin: 1 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pixCode]);

  const triggerRegenerate = React.useCallback(async () => {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setIsRegenerating(false);
    }
  }, [isRegenerating, onRegenerate]);

  const autoRegenOnExpiryRef = React.useRef(false);
  React.useEffect(() => {
    if (!isExpired) {
      autoRegenOnExpiryRef.current = false;
      return;
    }
    if (autoRegenOnExpiryRef.current) return;
    autoRegenOnExpiryRef.current = true;
    triggerRegenerate();
  }, [isExpired, triggerRegenerate]);

  if (isExpired) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        {isRegenerating ? (
          <>
            <Loader2 className="text-muted-foreground size-6 animate-spin" strokeWidth={1.25} />
            <p className="text-muted-foreground text-xs">{t("pixAnchorSettling")}</p>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t("pixAnchorExpired")}</p>
            <Button variant="outline" size="sm" onClick={triggerRegenerate} className="gap-2">
              <RefreshCw className="size-4" strokeWidth={1.25} />
              {t("pixAnchorRegenerate")}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="bg-background flex items-center justify-center rounded-md border p-2"
        style={{ width: QR_SIZE_PX + 16, height: QR_SIZE_PX + 16 }}
      >
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={t("pixAnchorCode")}
            width={QR_SIZE_PX}
            height={QR_SIZE_PX}
            className="block"
          />
        ) : (
          <div
            className="bg-muted animate-pulse rounded"
            style={{ width: QR_SIZE_PX, height: QR_SIZE_PX }}
          />
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-2">
        <dt className="text-muted-foreground text-xs">{t("pixAnchorCode")}</dt>
        <button
          type="button"
          onClick={() => setShowFullCode((v) => !v)}
          className="hover:bg-muted/50 max-w-full rounded px-2 py-1 transition-colors"
          aria-expanded={showFullCode}
        >
          <Mono className="text-foreground text-xs break-all">
            {showFullCode ? pixCode : truncateCode(pixCode)}
          </Mono>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => copy(pixCode)} className="gap-2">
          {copied ? (
            <Check className="size-4" strokeWidth={1.25} />
          ) : (
            <Copy className="size-4" strokeWidth={1.25} />
          )}
          {t("pixAnchorCopy")}
        </Button>
        <Mono className="text-muted-foreground text-xs">
          {t("pixAnchorExpiresIn", { seconds: secondsRemaining })}
        </Mono>
      </div>
    </div>
  );
}
