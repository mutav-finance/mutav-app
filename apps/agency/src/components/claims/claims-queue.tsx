"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { PlusIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { CASE_GROUP, brazilToday, type CaseGroup } from "@convex/delinquencies/domain";
import { Badge } from "@mutav/ui/badge";
import { Button } from "@mutav/ui/button";
import { ClaimStatusBadge } from "@mutav/ui/claim-status-tag";
import { Mono } from "@mutav/ui/mono";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@mutav/ui/tabs";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { usePathname, useRouter } from "@mutav/i18n/navigation";
import { useWorkspace } from "@/providers/workspace";
import { ClaimCaseSheet } from "@/components/claims/claim-case-sheet";
import { OpenNoticeSheet } from "@/components/delinquencies/open-notice-sheet";
import { liveCaseStatus, nextStepFor, type NextStep } from "@/lib/claims/case-view";
import { CLAIMS_CASE_PARAM, CLAIMS_NEW_VALUE } from "@/lib/guarantees/delinquency-actions";

type ClaimCaseRow = FunctionReturnType<typeof api.delinquencies.useCases.listCases>["rows"][number];

const GROUPS: readonly CaseGroup[] = [
  CASE_GROUP.NEEDS_YOU,
  CASE_GROUP.WITH_MUTAV,
  CASE_GROUP.CLOSED,
];

function isCaseGroup(value: string): value is CaseGroup {
  return GROUPS.some((group) => group === value);
}

/**
 * The claims queue: every late-rent case, grouped by who has to act. The
 * default tab is the work only the agency can move. A row opens the case
 * panel in a sheet (`?case=`); "Informar atraso" opens the report sheet.
 */
export function ClaimsQueue() {
  const t = useTranslations("claims.queue");
  const tStatus = useTranslations("delinquencies.caseStatus");
  const locale = useLocale();
  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;
  const [group, setGroup] = React.useState<CaseGroup>(CASE_GROUP.NEEDS_YOU);
  const [today] = React.useState(() => brazilToday(Date.now()));

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const caseParam = searchParams.get(CLAIMS_CASE_PARAM);

  const result = useQuery(
    api.delinquencies.useCases.listCases,
    agencyId ? { agencyId, group } : "skip",
  );

  function setCase(value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(CLAIMS_CASE_PARAM);
    else next.set(CLAIMS_CASE_PARAM, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const monthOf = (isoDate: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(
      new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`),
    );

  const nextStepText = (step: NextStep) => {
    switch (step.key) {
      case "waitUntil":
        return t("next.waitUntil", { date: formatDateBR(step.date) });
      case "answerRequest":
        return step.date
          ? t("next.answerRequestBy", { date: formatDateBR(step.date) })
          : t("next.answerRequest");
      default:
        return t(`next.${step.key}`);
    }
  };

  const rows = result?.rows ?? [];
  const isLoading = workspaceLoading || (agencyId !== undefined && result === undefined);

  return (
    <div className="flex flex-col gap-4 px-4 py-4 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={group} onValueChange={(value) => isCaseGroup(value) && setGroup(value)}>
          <TabsList>
            {GROUPS.map((option) => (
              <TabsTrigger key={option} value={option}>
                {t(`tabs.${option}`)} <Badge variant="count">{result?.counts[option] ?? 0}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setCase(CLAIMS_NEW_VALUE)}>
          <PlusIcon className="size-4" strokeWidth={1.5} />
          {t("reportLateRent")}
        </Button>
      </div>

      <div className="border-border rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col.case")}</TableHead>
              <TableHead>{t("col.month")}</TableHead>
              <TableHead className="text-right">{t("col.amount")}</TableHead>
              <TableHead>{t("col.status")}</TableHead>
              <TableHead>{t("col.next")}</TableHead>
              <TableHead>{t("col.updated")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agencyId === undefined && !workspaceLoading ? (
              <EmptyRow text={t("noAgency")} />
            ) : isLoading ? (
              <EmptyRow text={t("loading")} />
            ) : rows.length === 0 ? (
              <EmptyRow text={t(`empty.${group}`)} />
            ) : (
              rows.map((row: ClaimCaseRow) => {
                const status = liveCaseStatus(row, today);
                return (
                  <TableRow
                    key={row.publicId}
                    className="cursor-pointer"
                    onClick={() => setCase(row.publicId)}
                  >
                    <TableCell>
                      <button
                        type="button"
                        className="flex flex-col items-start text-left"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCase(row.publicId);
                        }}
                      >
                        <span className="text-sm font-medium">
                          {row.tenantName || t("unnamedTenant")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {[row.streetAndNumber, row.complement].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{monthOf(row.rentDueDate)}</TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm">{formatBRLCents(row.originalAmountCents)}</Mono>
                    </TableCell>
                    <TableCell>
                      <ClaimStatusBadge status={status}>{tStatus(status)}</ClaimStatusBadge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {nextStepText(
                        nextStepFor({
                          status,
                          claimableFrom: row.claimableFrom,
                          requestDueAt: row.requestDueAt,
                        }),
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateBR(row.updatedAt)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {agencyId ? (
        <OpenNoticeSheet
          open={caseParam === CLAIMS_NEW_VALUE}
          agencyId={agencyId}
          onClose={() => setCase(null)}
          onSuccess={(publicId) => setCase(publicId)}
        />
      ) : null}
      <ClaimCaseSheet
        publicId={caseParam && caseParam !== CLAIMS_NEW_VALUE ? caseParam : null}
        onClose={() => setCase(null)}
      />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={6} className="text-muted-foreground py-10 text-center text-sm">
        {text}
      </TableCell>
    </TableRow>
  );
}
