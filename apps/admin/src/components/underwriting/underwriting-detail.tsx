"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { GuaranteeStateTag, StatusTag } from "@mutav/ui/guarantee-state-tag";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mutav/ui/alert-dialog";
import {
  useUnderwritingDetail,
  type UnderwritingDetailViewModel,
} from "@/hooks/use-underwriting-detail";
import { RATE_BOUNDS_PERCENT } from "@/components/underwriting/view-model";

const BASIS_POINTS_PER_UNIT = 10_000;

export function UnderwritingDetail({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.guarantees.reviewQueries.getAnalysisDetail>;
}) {
  const t = useTranslations("underwriting");
  const view = useUnderwritingDetail({ preloaded });
  const detail = view.detail;

  if (detail === null) {
    return (
      <PageShell>
        <PageHeader variant="hero" width="narrow" title={t("detail.notFound")} />
        <PageContent variant="narrow">
          <Button variant="outline" asChild className="w-fit">
            <Link href="/underwriting">{t("detail.back")}</Link>
          </Button>
        </PageContent>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        variant="hero"
        width="narrow"
        breadcrumb={
          <Link href="/underwriting" className="text-muted-foreground text-base-sm">
            {t("detail.back")}
          </Link>
        }
        title={t("detail.title", { id: detail.publicId })}
        subtitle={detail.agency.name}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/guarantees/${detail.publicId}`}>{t("actions.openGuarantee")}</Link>
          </Button>
        }
      />
      <PageContent variant="narrow">
        <DecisionCard view={view} />
        <CreditCard view={view} />
        <Section title={t("detail.tenant")}>
          {detail.tenant === null ? (
            <p className="text-muted-foreground">{t("notAvailable")}</p>
          ) : (
            <Rows
              rows={[
                [t("detail.fields.name"), detail.tenant.fullName],
                [t("detail.fields.taxId"), <Mono key="tax">{detail.tenant.taxId}</Mono>],
                [t("detail.fields.email"), detail.tenant.email],
                [t("detail.fields.phone"), detail.tenant.phone],
              ]}
            />
          )}
        </Section>
        <Section title={t("detail.lease")}>
          <Rows
            rows={[
              [t("detail.fields.propertyKind"), t(`propertyKind.${detail.lease.propertyKind}`)],
              [
                t("detail.fields.address"),
                `${detail.lease.property.streetAndNumber} — ${detail.lease.property.neighborhood}, ${detail.lease.property.cityUF}`,
              ],
              [t("detail.fields.rent"), formatBRLCents(detail.lease.rent.rentCents)],
              [t("detail.fields.totalRent"), formatBRLCents(detail.lease.rent.totalRentCents)],
            ]}
          />
        </Section>
        <TermsCard view={view} />
        <Section title={t("detail.history")}>
          <ul className="flex flex-col gap-2">
            {detail.history.map((entry) => (
              <li key={`${entry.at}-${entry.message}`} className="flex justify-between gap-4">
                <span>{entry.message}</span>
                <span className="text-muted-foreground">
                  {entry.username} · {formatDateBR(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </PageContent>

      <AcceptDialog view={view} />
      <RefuseDialog view={view} />
    </PageShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {title}
        </Eyebrow>
      </CardHeader>
      <CardContent className="text-base-sm py-4">{children}</CardContent>
    </Card>
  );
}

function Rows({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function usePercent() {
  const format = useFormatter();
  return (bps: number) =>
    format.number(bps / BASIS_POINTS_PER_UNIT, { style: "percent", maximumFractionDigits: 2 });
}

function DecisionCard({ view }: { view: UnderwritingDetailViewModel }) {
  const t = useTranslations("underwriting");
  const percent = usePercent();
  const detail = view.detail;
  if (!detail) return null;
  const { review } = detail;

  return (
    <Section title={t("detail.decision")}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusTag tone={review.status === "refused" ? "error" : "neutral"}>
            {t(`reviewStatus.${review.status}`)}
          </StatusTag>
          <GuaranteeStateTag state={detail.status}>
            {t(`guaranteeState.${detail.status}`)}
          </GuaranteeStateTag>
        </div>
        <Rows
          rows={[
            ...(review.requestedAt
              ? [[t("detail.fields.requestedAt"), formatDateBR(review.requestedAt)] as const]
              : []),
            ...(review.acceptedFeeRateBps !== null
              ? [[t("detail.fields.staffRate"), percent(review.acceptedFeeRateBps)] as const]
              : []),
            ...(review.decisionNote
              ? [[t("detail.fields.note"), review.decisionNote] as const]
              : []),
            ...(review.refusalReason
              ? [[t("detail.fields.refusalReason"), review.refusalReason] as const]
              : []),
            ...(review.decidedByName
              ? [[t("detail.fields.decidedBy"), review.decidedByName] as const]
              : []),
            ...(review.sentForSignatureAt
              ? [[t("detail.fields.sentAt"), formatDateBR(review.sentForSignatureAt)] as const]
              : []),
          ]}
        />
        {(view.canDecide || view.canSend) && (
          <div className="flex flex-wrap gap-2">
            {view.canDecide && (
              <>
                <Button disabled={view.busy} onClick={view.accept.open}>
                  {t("actions.accept")}
                </Button>
                <Button variant="destructive" disabled={view.busy} onClick={view.refuse.open}>
                  {t("actions.refuse")}
                </Button>
              </>
            )}
            {view.canSend && (
              <Button disabled={view.busy} onClick={view.send}>
                {t("actions.markSent")}
              </Button>
            )}
          </div>
        )}
        {view.canSend && <p className="text-muted-foreground">{t("detail.sendHint")}</p>}
      </div>
    </Section>
  );
}

function CreditCard({ view }: { view: UnderwritingDetailViewModel }) {
  const t = useTranslations("underwriting");
  const detail = view.detail;
  if (!detail) return null;
  const { credit } = detail;

  return (
    <Section title={t("detail.credit")}>
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">{t("detail.scoreIsInput")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Mono className="text-xl font-medium">{credit.score}</Mono>
          <StatusTag tone={credit.tier === "negado" ? "caution" : "neutral"}>
            {t(`tier.${credit.tier}`)}
          </StatusTag>
          {credit.isMock && <StatusTag tone="expiring">{t("mockScore")}</StatusTag>}
        </div>
        <Rows
          rows={[
            [t("detail.fields.provider"), credit.provider ?? t("notAvailable")],
            [
              t("detail.fields.assessedAt"),
              credit.assessedAt === null
                ? t("notAvailable")
                : formatDateBR(new Date(credit.assessedAt).toISOString()),
            ],
            [t("detail.fields.policyVersion"), credit.policyVersion ?? t("notAvailable")],
          ]}
        />
        {credit.signals.length > 0 && (
          <div className="flex flex-col gap-2">
            <Eyebrow className="font-medium">{t("detail.signals")}</Eyebrow>
            <ul className="flex flex-col gap-1">
              {credit.signals.map((signal) => (
                <li key={`${signal.provider}-${signal.pulledAt}`} className="flex gap-3">
                  <span>{signal.provider}</span>
                  <span className="text-muted-foreground">
                    {t(`signalStatus.${signal.status}`)}
                  </span>
                  {signal.score !== null && (
                    <Mono>
                      {signal.score}/{signal.scale}
                    </Mono>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function TermsCard({ view }: { view: UnderwritingDetailViewModel }) {
  const t = useTranslations("underwriting");
  const percent = usePercent();
  const detail = view.detail;
  if (!detail) return null;
  const { terms } = detail;

  return (
    <Section title={t("detail.terms")}>
      <Rows
        rows={[
          [t("detail.fields.product"), terms.productSlug],
          [t("detail.fields.plan"), t(`plan.${terms.plan}`)],
          [t("detail.fields.feeRate"), percent(terms.feeRateBps)],
          [t("detail.fields.fee"), formatBRLCents(terms.feeCents)],
          [t("detail.fields.coverageCeiling"), formatBRLCents(terms.coverageCeilingCents)],
          [t("detail.fields.exitCostCap"), formatBRLCents(terms.exitCostCapCents)],
          [t("detail.fields.activationFee"), formatBRLCents(terms.oneTimeActivationFeeCents)],
        ]}
      />
    </Section>
  );
}

function AcceptDialog({ view }: { view: UnderwritingDetailViewModel }) {
  const t = useTranslations("underwriting");
  return (
    <AlertDialog open={view.accept.isOpen} onOpenChange={(open) => !open && view.accept.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("accept.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("accept.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="accept-rate">{t("accept.rateLabel")}</Label>
            <Input
              id="accept-rate"
              inputMode="decimal"
              value={view.accept.rateInput}
              onChange={(event) => view.accept.setRateInput(event.target.value)}
              aria-invalid={!view.accept.rateIsValid}
            />
            <p className="text-muted-foreground text-xs">
              {t("accept.rateHint", RATE_BOUNDS_PERCENT)}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="accept-note">{t("accept.noteLabel")}</Label>
            <Input
              id="accept-note"
              value={view.accept.note}
              onChange={(event) => view.accept.setNote(event.target.value)}
              placeholder={t("accept.notePlaceholder")}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={view.busy || !view.accept.rateIsValid}
            onClick={(event) => {
              event.preventDefault();
              void view.accept.confirm();
            }}
          >
            {t("accept.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RefuseDialog({ view }: { view: UnderwritingDetailViewModel }) {
  const t = useTranslations("underwriting");
  return (
    <AlertDialog open={view.refuse.isOpen} onOpenChange={(open) => !open && view.refuse.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("refuse.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("refuse.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="refuse-reason">{t("refuse.reasonLabel")}</Label>
          <Input
            id="refuse-reason"
            value={view.refuse.reason}
            onChange={(event) => view.refuse.setReason(event.target.value)}
            placeholder={t("refuse.reasonPlaceholder")}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={view.busy || !view.refuse.reasonIsValid}
            onClick={(event) => {
              event.preventDefault();
              void view.refuse.confirm();
            }}
          >
            {t("refuse.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
