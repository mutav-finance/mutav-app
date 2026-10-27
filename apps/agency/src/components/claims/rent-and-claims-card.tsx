"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CASE_GROUP, brazilToday, caseGroupOf } from "@convex/delinquencies/domain";
import { Button } from "@mutav/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { ClaimStatusTag } from "@mutav/ui/claim-status-tag";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Mono } from "@mutav/ui/mono";
import { StepIndicator } from "@mutav/ui/step-indicator";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { ClaimCaseSheet } from "@/components/claims/claim-case-sheet";
import { OpenNoticeSheet } from "@/components/delinquencies/open-notice-sheet";
import { CASE_STEPS, caseStep, liveCaseStatus, nextStepFor } from "@/lib/claims/case-view";
import { reportLateRentAction } from "@/lib/guarantees/delinquency-actions";
import type { Guarantee } from "@/lib/guarantees/types";

const HISTORY_PAGE_SIZE = 200;

/**
 * The guarantee page's view of its late rent: the open case up front with its
 * stepper and the one next action, the months already reported below. Both
 * open the same case panel the claims queue uses.
 */
export function RentAndClaimsCard({ guarantee }: { guarantee: Guarantee }) {
  const t = useTranslations("claims.card");
  const tPanel = useTranslations("claims.panel");
  const tQueue = useTranslations("claims.queue");
  const tStatus = useTranslations("delinquencies.caseStatus");
  const locale = useLocale();
  const [today] = React.useState(() => brazilToday(Date.now()));
  const [openCase, setOpenCase] = React.useState<string | null>(null);
  const [reporting, setReporting] = React.useState(false);
  const report = reportLateRentAction(guarantee);

  const result = useQuery(api.delinquencies.useCases.listByAgency, {
    agencyId: guarantee.agencyId,
    guaranteePublicId: guarantee.id,
    paginationOpts: { numItems: HISTORY_PAGE_SIZE, cursor: null },
  });
  const cases = (result?.page ?? [])
    .map((row) => ({ ...row, live: liveCaseStatus(row, today) }))
    .sort((a, b) => b.rentDueDate.localeCompare(a.rentDueDate));
  const current = cases.find((row) => caseGroupOf(row.live) !== CASE_GROUP.CLOSED) ?? null;

  const monthOf = (isoDate: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`),
    );

  const nextStepText = () => {
    if (!current) return null;
    const step = nextStepFor({
      status: current.live,
      claimableFrom: current.claimableFrom,
      requestDueAt: null,
    });
    switch (step.key) {
      case "waitUntil":
        return tQueue("next.waitUntil", { date: formatDateBR(step.date) });
      case "answerRequest":
        return tQueue("next.answerRequest");
      default:
        return tQueue(`next.${step.key}`);
    }
  };

  const step = current ? caseStep(current.live) : null;

  return (
    <>
      <Card className={current ? "border-warning-strong" : undefined}>
        <CardHeader className="border-b">
          <Eyebrow as={CardTitle} size="xs" className="font-medium">
            {t("heading")}
          </Eyebrow>
          {report.enabled ? (
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setReporting(true)}>
                {current ? t("reportAnother") : t("report")}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4 py-4">
          {result === undefined ? (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          ) : current ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-medium">
                  {t("rentOf", { month: monthOf(current.rentDueDate) })} ·{" "}
                  {formatBRLCents(current.originalAmountCents)}
                </p>
                <ClaimStatusTag status={current.live}>{tStatus(current.live)}</ClaimStatusTag>
              </div>
              {step !== null ? (
                <StepIndicator
                  current={step}
                  labels={CASE_STEPS.map((key) => tPanel(`steps.${key}`))}
                  progressLabel={tPanel("progress")}
                  doneSuffix={tPanel("stepDone")}
                  currentSuffix={tPanel("stepCurrent")}
                />
              ) : null}
              <p className="text-muted-foreground text-sm">{nextStepText()}</p>
              <div>
                <Button onClick={() => setOpenCase(current.publicId)}>{t("openCase")}</Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {report.enabled ? t("upToDate") : t("notInForce")}
            </p>
          )}

          {cases.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Eyebrow size="xs">{t("history")}</Eyebrow>
              <ul className="flex flex-col divide-y rounded border">
                {cases.map((row) => (
                  <li
                    key={row.publicId}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm capitalize">{monthOf(row.rentDueDate)}</span>
                    <Mono className="text-sm">{formatBRLCents(row.originalAmountCents)}</Mono>
                    <ClaimStatusTag status={row.live}>{tStatus(row.live)}</ClaimStatusTag>
                    <Button variant="ghost" size="sm" onClick={() => setOpenCase(row.publicId)}>
                      {t("view")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {report.enabled ? (
        <OpenNoticeSheet
          open={reporting}
          agencyId={guarantee.agencyId}
          fixedGuaranteePublicId={guarantee.id}
          onClose={() => setReporting(false)}
          onSuccess={(publicId) => {
            setReporting(false);
            setOpenCase(publicId);
          }}
        />
      ) : null}
      <ClaimCaseSheet publicId={openCase} onClose={() => setOpenCase(null)} />
    </>
  );
}
