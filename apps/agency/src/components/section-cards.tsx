"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { AlertTriangleIcon, CalendarIcon, FileTextIcon, ShieldAlertIcon } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@mutav/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import { api } from "@convex/_generated/api";
import { INSURED_STATES } from "@convex/guarantees/domain";
import { useWorkspace } from "@/providers/workspace";
import { GuaranteeStateBreakdown } from "@/components/guarantees/guarantee-state-breakdown";
import { formatBRLCents, formatDateBR } from "@/lib/guarantees/format";

export function SectionCards() {
  const t = useTranslations("metrics");
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const summary = useQuery(
    api.guarantees.useCases.getStatusCounts,
    agencyId ? { agencyId } : "skip",
  );

  const nextPayment = useQuery(
    api.invoices.useCases.getNextOpenInvoice,
    agencyId ? { agencyId } : "skip",
  );

  const overdueCount = useQuery(
    api.invoices.useCases.getOverdueCount,
    agencyId ? { agencyId } : "skip",
  );

  const inForceCount = summary
    ? INSURED_STATES.reduce((total, state) => total + summary[state], 0)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @md/main:grid-cols-2 @4xl/main:grid-cols-4">
        {/* In force — every insured state, not just `active` */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <FileTextIcon className="size-3.5" />
              {t("inForce.label")}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {inForceCount ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">{t("inForce.footer")}</div>
          </CardFooter>
        </Card>

        {/* Drafts */}
        <Card className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <AlertTriangleIcon className="size-3.5" />
              {t("drafted.label")}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {summary ? summary.drafted : "—"}
            </CardTitle>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">{t("drafted.footer")}</div>
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
      <div className="px-4 lg:px-6">
        <GuaranteeStateBreakdown heading={t("byState")} counts={summary} />
      </div>
    </div>
  );
}
