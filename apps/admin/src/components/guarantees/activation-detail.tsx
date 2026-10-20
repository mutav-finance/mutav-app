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
import { GuaranteeStateTag, StatusTag } from "@mutav/ui/guarantee-state-tag";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { StepIndicator } from "@mutav/ui/step-indicator";
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
import { GuaranteeDocumentsPanel } from "@/components/guarantees/guarantee-documents-panel";
import {
  ACTIVATION_STEPS,
  REVIEW_STATUS_TONE,
  SIGNED_CONTRACT_TONE,
} from "@/components/guarantees/view-model";
import { useActivationDetail, type ActivationDetailViewModel } from "@/hooks/use-activation-detail";

const BASIS_POINTS_PER_UNIT = 10_000;

export function ActivationDetail({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.guarantees.activationQueries.getActivationDetail>;
}) {
  const t = useTranslations("staffGuarantees");
  const view = useActivationDetail({ preloaded });
  const detail = view.detail;

  if (detail === null) {
    return (
      <PageShell>
        <PageHeader variant="hero" width="narrow" title={t("detail.notFound")} />
        <PageContent variant="narrow">
          <Button variant="outline" asChild className="w-fit">
            <Link href="/guarantees">{t("detail.back")}</Link>
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
          <Link href="/guarantees" className="text-muted-foreground text-base-sm">
            {t("detail.back")}
          </Link>
        }
        title={t("detail.title", { id: detail.publicId })}
        subtitle={detail.agency.name}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/underwriting/${detail.publicId}`}>{t("actions.openUnderwriting")}</Link>
          </Button>
        }
      />
      <PageContent variant="narrow">
        <ActivationCard view={view} />
        <SummaryCard view={view} />
        <GuaranteeDocumentsPanel publicId={detail.publicId} />
        <LeaseCard view={view} />
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

      <ConfirmActivateDialog view={view} />
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

function ActivationCard({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const detail = view.detail;
  if (!detail) return null;

  return (
    <Section title={t("detail.activation")}>
      <div className="flex flex-col gap-4">
        <StepIndicator
          current={view.stepPosition}
          labels={ACTIVATION_STEPS.map((step) => t(`stepper.steps.${step}`))}
          progressLabel={t("stepper.progressLabel")}
          doneSuffix={t("stepper.doneSuffix")}
          currentSuffix={t("stepper.currentSuffix")}
        />
        {view.isActive && detail.activatedAt !== null ? (
          <p>{t("detail.activatedOn", { date: formatDateBR(detail.activatedAt) })}</p>
        ) : view.canActivate ? (
          <p className="text-muted-foreground">{t("detail.ready")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t("detail.blockedHeading")}</p>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
              {view.blockers.map((blocker) => (
                <li key={blocker}>{t(`blockers.${blocker}`)}</li>
              ))}
            </ul>
          </div>
        )}
        {!view.isActive && (
          <div>
            <Button disabled={!view.canActivate || view.busy} onClick={view.confirm.open}>
              {t("actions.activate")}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

function SummaryCard({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const detail = view.detail;
  if (!detail) return null;

  return (
    <Section title={t("detail.summary")}>
      <Rows
        rows={[
          [
            t("detail.fields.agency"),
            <span key="agency" className="flex flex-wrap items-center gap-2">
              {detail.agency.name}
              {!detail.agency.active && <StatusTag tone="error">{t("agencyInactive")}</StatusTag>}
            </span>,
          ],
          [t("detail.fields.tenant"), detail.tenant?.fullName ?? t("notAvailable")],
          [
            t("detail.fields.status"),
            <GuaranteeStateTag key="status" state={detail.status}>
              {t(`guaranteeState.${detail.status}`)}
            </GuaranteeStateTag>,
          ],
          [
            t("detail.fields.review"),
            <StatusTag key="review" tone={REVIEW_STATUS_TONE[detail.review.status]}>
              {t(`reviewStatus.${detail.review.status}`)}
            </StatusTag>,
          ],
          [
            t("detail.fields.signedContract"),
            <StatusTag key="contract" tone={SIGNED_CONTRACT_TONE[detail.signedContract]}>
              {t(`signedContract.${detail.signedContract}`)}
            </StatusTag>,
          ],
          ...(detail.review.sentForSignatureAt
            ? [[t("detail.fields.sentAt"), formatDateBR(detail.review.sentForSignatureAt)] as const]
            : []),
        ]}
      />
    </Section>
  );
}

function LeaseCard({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const detail = view.detail;
  if (!detail) return null;
  const { lease } = detail;

  return (
    <Section title={t("detail.lease")}>
      <Rows
        rows={[
          [t("detail.fields.propertyKind"), t(`propertyKind.${lease.propertyKind}`)],
          [
            t("detail.fields.address"),
            `${lease.property.streetAndNumber} — ${lease.property.neighborhood}, ${lease.property.cityUF}`,
          ],
          [t("detail.fields.rent"), formatBRLCents(lease.rent.rentCents)],
          [t("detail.fields.totalRent"), formatBRLCents(lease.rent.totalRentCents)],
        ]}
      />
    </Section>
  );
}

function TermsCard({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const percent = usePercent();
  const detail = view.detail;
  if (!detail) return null;
  const { terms, review } = detail;

  return (
    <Section title={t("detail.terms")}>
      <Rows
        rows={[
          [t("detail.fields.product"), terms.productSlug],
          [t("detail.fields.plan"), t(`plan.${terms.plan}`)],
          ...(review.acceptedFeeRateBps !== null
            ? [[t("detail.fields.staffRate"), percent(review.acceptedFeeRateBps)] as const]
            : [[t("detail.fields.feeRate"), percent(terms.feeRateBps)] as const]),
          [t("detail.fields.fee"), formatBRLCents(terms.feeCents)],
          [t("detail.fields.coverageCeiling"), formatBRLCents(terms.coverageCeilingCents)],
          [t("detail.fields.activationFee"), formatBRLCents(terms.oneTimeActivationFeeCents)],
        ]}
      />
    </Section>
  );
}

function ConfirmActivateDialog({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  return (
    <AlertDialog open={view.confirm.isOpen} onOpenChange={(open) => !open && view.confirm.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("confirm.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={view.busy || !view.canActivate}
            onClick={(event) => {
              event.preventDefault();
              void view.confirm.submit();
            }}
          >
            {t("confirm.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
