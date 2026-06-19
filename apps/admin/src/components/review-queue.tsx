"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useConvex, useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AgencyDocumentKind, OnboardingState } from "@convex/agencies/domain";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mutav/ui/card";
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Badge } from "@mutav/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@mutav/ui/alert-dialog";
import { DownloadIcon } from "lucide-react";
import { maskCNPJ } from "@/lib/brazil";

type PendingAgency = FunctionReturnType<typeof api.mutavStaff.useCases.listPendingReviews>[number];

export function ReviewQueue({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.mutavStaff.useCases.listPendingReviews>;
}) {
  const agencies = usePreloadedQuery(preloaded);
  const t = useTranslations("adminReview");

  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          {agencies.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("empty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {agencies.map((agency) => (
                <ReviewCard key={agency._id} agency={agency} />
              ))}
            </div>
          )}
        </div>
      </PageContent>
    </PageShell>
  );
}

function stateBadgeVariant(state: OnboardingState | undefined) {
  return state === "under_review" ? "outline" : "secondary";
}

function ReviewCard({ agency }: { agency: PendingAgency }) {
  const t = useTranslations("adminReview");
  const locale = useLocale();
  const convex = useConvex();
  const reviewOnboarding = useMutation(api.mutavStaff.useCases.reviewOnboarding);

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submittedLabel = agency.onboardingSubmittedAt
    ? new Intl.DateTimeFormat(locale).format(new Date(agency.onboardingSubmittedAt))
    : null;

  const cnpjLabel = agency.cnpj ? maskCNPJ(agency.cnpj) : (agency.cpf ?? null);

  async function openDocument(kind: AgencyDocumentKind) {
    const url = await convex.query(api.mutavStaff.useCases.getDocumentDownloadUrl, {
      agencyId: agency._id,
      kind,
    });
    if (!url) {
      toast.error(t("errors.documentUnavailable"));
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function review(args: {
    agencyId: Id<"agencies">;
    decision: "approved" | "rejected";
    rejectionReason?: string;
  }) {
    setBusy(true);
    try {
      const result = await reviewOnboarding(args);
      if (!result.success) {
        toast.error(t(`errors.${result.error.code}`));
        return;
      }
      toast.success(args.decision === "approved" ? t("approved") : t("rejected"));
    } catch {
      // mutationWithMutavRole throws on auth/role failure (the staff gate is
      // server-side, so this rarely fires) — surface a generic error, not a
      // misleading "not reviewable".
      toast.error(t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{agency.name}</CardTitle>
        {cnpjLabel && <CardDescription>{cnpjLabel}</CardDescription>}
        <CardAction>
          <Badge variant={stateBadgeVariant(agency.onboardingState)}>
            {t(`state.${agency.onboardingState}`)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {submittedLabel && (
          <p className="text-muted-foreground text-base-sm">
            {t("submittedAt")} {submittedLabel}
          </p>
        )}

        {agency.documents.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-foreground text-base-sm font-medium">{t("documentsLabel")}</p>
            <div className="flex flex-wrap gap-2">
              {agency.documents.map((doc) => (
                <Button
                  key={doc._id}
                  variant="outline"
                  size="sm"
                  onClick={() => openDocument(doc.kind)}
                >
                  <DownloadIcon />
                  {t(`docKind.${doc.kind}`)}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => review({ agencyId: agency._id, decision: "approved" })}
          >
            {t("approve")}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busy}>
                {t("reject")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("rejectDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("rejectDialogDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t("rejectReasonPlaceholder")}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    review({
                      agencyId: agency._id,
                      decision: "rejected",
                      rejectionReason: reason || undefined,
                    })
                  }
                >
                  {t("confirmReject")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
