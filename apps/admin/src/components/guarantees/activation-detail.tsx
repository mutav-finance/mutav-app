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
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { GuaranteeDocumentsPanel } from "@/components/guarantees/guarantee-documents-panel";
import {
  ACTIVATION_STEPS,
  baseUnitsToCents,
  OFFER_HOLD_TONE,
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
        <RegistrationCard view={view} />
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

function RegistrationCard({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const detail = view.detail;
  if (!detail) return null;
  const { registration } = detail;

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
          <div className="flex flex-col gap-1">
            <p>{t("detail.activatedOn", { date: formatDateBR(detail.activatedAt) })}</p>
            {registration.confirmed && (
              <p className="text-muted-foreground break-all">
                {t("registration.confirmedTx")} <Mono>{registration.confirmed.txSignature}</Mono>
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="text-muted-foreground">{t("registration.explainer")}</p>
            <ExpectedRegistration view={view} />
            <OfferHoldRows view={view} />
            {registration.refusal && (
              <div className="border-destructive/40 flex flex-col gap-1 rounded-md border p-3">
                <p className="font-medium">
                  {t("registration.refusedHeading", {
                    error: registration.refusal.programErrorName,
                    code: registration.refusal.programErrorCode,
                  })}
                </p>
                <p className="text-muted-foreground">
                  {t("registration.refusedOn", {
                    date: formatDateBR(registration.refusal.refusedAt),
                  })}
                </p>
                <p className="text-muted-foreground break-all">
                  <Mono>{registration.refusal.txSignature}</Mono>
                </p>
                <p className="text-muted-foreground">{t("registration.refusedNextStep")}</p>
              </div>
            )}
            {view.canRegister ? (
              <RecordRegistrationForm view={view} />
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
          </>
        )}
      </div>
    </Section>
  );
}

function ExpectedRegistration({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const detail = view.detail;
  if (!detail) return null;
  const { expected } = detail.registration;
  const cover = (baseUnits: string) => (
    <span className="flex flex-col">
      <Mono>{baseUnits}</Mono>
      <span className="text-muted-foreground text-xs">
        {formatBRLCents(baseUnitsToCents(baseUnits))}
      </span>
    </span>
  );

  return (
    <Rows
      rows={[
        [
          t("registration.fields.onchainId"),
          <Mono key="id" className="break-all">
            {expected.onchainIdHex}
          </Mono>,
        ],
        [t("registration.fields.defaultCover"), cover(expected.defaultCoverBaseUnits)],
        [t("registration.fields.exitCover"), cover(expected.exitCoverBaseUnits)],
      ]}
    />
  );
}

function OfferHoldRows({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const hold = view.detail?.offerHold;
  if (!hold) return null;

  return (
    <div className="flex flex-col gap-2">
      <Rows
        rows={[
          [
            t("offerHold.label"),
            <StatusTag key="hold" tone={OFFER_HOLD_TONE[hold.status]}>
              {t(`offerHold.status.${hold.status}`)}
            </StatusTag>,
          ],
          [t("offerHold.amount"), formatBRLCents(baseUnitsToCents(hold.amountBaseUnits))],
          [
            t("offerHold.period"),
            t("offerHold.periodValue", {
              days: hold.holdDays,
              date: formatDateBR(new Date(hold.expiresAt).toISOString()),
            }),
          ],
        ]}
      />
      {hold.status === "lapsed" && <p className="text-destructive">{t("offerHold.lapsedHint")}</p>}
    </div>
  );
}

function RecordRegistrationForm({ view }: { view: ActivationDetailViewModel }) {
  const t = useTranslations("staffGuarantees");
  const form = view.registration;
  const showInvalid = form.txSignature.trim().length > 0 && !form.signatureIsValid;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
    >
      <Label htmlFor="registration-tx">{t("registration.txLabel")}</Label>
      <Input
        id="registration-tx"
        value={form.txSignature}
        onChange={(event) => form.setTxSignature(event.target.value)}
        placeholder={t("registration.txPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={showInvalid}
      />
      {showInvalid && <p className="text-destructive text-xs">{t("registration.txInvalid")}</p>}
      <div>
        <Button type="submit" disabled={view.busy || !form.signatureIsValid}>
          {view.busy ? t("registration.verifying") : t("actions.recordRegistration")}
        </Button>
      </div>
    </form>
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
