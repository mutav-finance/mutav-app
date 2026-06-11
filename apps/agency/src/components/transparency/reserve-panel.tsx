"use client";

import { useTranslations, useLocale } from "next-intl";
import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { ReserveCoverage } from "@convex/transparency/domain";

type Props = { coverage: ReserveCoverage | null | undefined };

export function ReservePanel({ coverage }: Props) {
  const t = useTranslations("transparency.reserve");
  const locale = useLocale();
  const loading = coverage === null || coverage === undefined;

  const asOf =
    coverage?.available && coverage.capturedAt
      ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(coverage.capturedAt),
        )
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheckIcon className="size-3.5" />
          {t("label")}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : coverage.available ? (
            Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(
              coverage.storedValueCents / 100,
            )
          ) : (
            <span className="text-muted-foreground text-base">{t("unavailable")}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <div className="flex flex-col gap-1.5">
            {asOf ? (
              <span className="text-muted-foreground text-xs">{t("asOf", { datetime: asOf })}</span>
            ) : null}
            <a
              href={coverage.explorerUrl}
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
