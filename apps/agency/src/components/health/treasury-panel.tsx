"use client";

import { useTranslations } from "next-intl";
import { ExternalLinkIcon, LinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { TreasurySnapshot } from "@convex/health/domain";

type Props = {
  treasury: TreasurySnapshot | null;
  error: boolean;
};

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function TreasuryPanel({ treasury, error }: Props) {
  const t = useTranslations("health.treasury");
  const loading = !treasury && !error;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <LinkIcon className="size-3.5" />
          {t("label")}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : error ? (
            <span className="text-muted-foreground text-base">{t("unavailable")}</span>
          ) : (
            <span>
              {treasury?.xlmBalance.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) ?? "—"}{" "}
              XLM
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : error || !treasury ? null : (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs">
              {truncateAddress(treasury.address)}
            </span>
            <a
              href={treasury.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              {t("viewExplorer")}
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
