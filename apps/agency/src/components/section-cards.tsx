"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { AlertTriangleIcon, CalendarIcon, FileTextIcon, ShieldAlertIcon } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";

export function SectionCards() {
  const t = useTranslations("metrics");
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const summary = useQuery(
    api.contracts.useCases.getPipelineSummary,
    agencyId ? { agencyId } : "skip",
  );

  const nextPayment = useQuery(
    api.payments.useCases.getNextPendingPayment,
    agencyId ? { agencyId } : "skip",
  );

  const overdueCount = useQuery(
    api.payments.useCases.getOverdueCount,
    agencyId ? { agencyId } : "skip",
  );

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @md/main:grid-cols-2 @4xl/main:grid-cols-4">
      {/* Ativos */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <FileTextIcon className="size-3.5" />
            {t("ativo.label")}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {summary ? summary.ativo : "—"}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">{t("ativo.footer")}</div>
        </CardFooter>
      </Card>

      {/* Pendentes */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <AlertTriangleIcon className="size-3.5" />
            {t("pendente.label")}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {summary ? summary.pendente : "—"}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">{t("pendente.footer")}</div>
        </CardFooter>
      </Card>

      {/* Próxima Fatura */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <CalendarIcon className="size-3.5" />
            {t("nextPayment.label")}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {nextPayment === undefined
              ? "—"
              : nextPayment === null
                ? t("nextPayment.noneLabel")
                : formatBRLCents(nextPayment.totalCents)}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">
            {nextPayment
              ? t("nextPayment.dueOn", { date: formatDateBR(nextPayment.dueDate) })
              : t("nextPayment.footer")}
          </div>
        </CardFooter>
      </Card>

      {/* Inadimplências — overdue payment count, an approximation of the
          delinquency concept until issue #52 ships a dedicated domain. */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5">
            <ShieldAlertIcon className="size-3.5" />
            {t("delinquencies.label")}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {overdueCount === undefined ? <Skeleton className="h-8 w-10" /> : overdueCount}
          </CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">
            {overdueCount === undefined ? (
              <Skeleton className="h-4 w-32" />
            ) : overdueCount === 0 ? (
              t("delinquencies.footerNone")
            ) : (
              t("delinquencies.footerSome", { count: overdueCount })
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
