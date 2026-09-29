"use client";

import * as React from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
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
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@mutav/ui/dropdown-menu";
import { Mono } from "@mutav/ui/mono";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";
import { cn } from "@mutav/ui/cn";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { GUARANTEE_STATE } from "@convex/guarantees/domain";
import type { Guarantee } from "@/lib/guarantees/types";
import { api } from "@convex/_generated/api";
import { GuaranteeStateTag } from "@mutav/ui/guarantee-state-tag";
import { Link } from "@mutav/i18n/navigation";
import { OpenNoticeSheet } from "@/components/delinquencies/open-notice-sheet";
import { guaranteeDelinquencyActions } from "@/lib/guarantees/delinquency-actions";

export function GuaranteeSummaryCard({ guarantee }: { guarantee: Guarantee }) {
  const t = useTranslations("guaranteeDetails.summary");
  const tState = useTranslations("guaranteeDetails.state");
  const tCloseReason = useTranslations("guaranteeDetails.closeReason");
  const isDrafted = guarantee.status === GUARANTEE_STATE.DRAFTED;
  const cancelDraft = useMutation(api.guarantees.useCases.cancelDraft);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [isCanceling, setIsCanceling] = React.useState(false);
  const [openNoticeOpen, setOpenNoticeOpen] = React.useState(false);
  const delinquencyActions = guaranteeDelinquencyActions(guarantee);
  const openDelinquencyHint = delinquencyActions.open.enabled
    ? t("openDelinquencyHint")
    : t("openDelinquencyDisabledHint");
  const trackDelinquenciesHint = delinquencyActions.track.enabled
    ? t("trackDelinquenciesHint")
    : t("trackDelinquenciesDisabledHint");

  // The row keeps `available + reserved = ceiling` for its whole life, so a
  // closed guarantee still carries capacity it no longer covers anything with.
  const availableCapacityCents =
    guarantee.status === GUARANTEE_STATE.CLOSED ? 0 : guarantee.capacity.availableCents;

  async function handleConfirmCancel() {
    setIsCanceling(true);
    try {
      const result = await cancelDraft({
        agencyId: guarantee.agencyId,
        publicId: guarantee.id,
      });
      if (result.success) {
        setCancelOpen(false);
      } else {
        toast.error(t(`errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setIsCanceling(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <Eyebrow as={CardTitle} size="xs" className="font-medium">
            {t("heading")}
          </Eyebrow>
          <CardAction className="flex items-center gap-2">
            {/* Desktop: show all buttons inline */}
            <div className="hidden items-center gap-2 sm:flex">
              {/* A disabled button swallows pointer events, so a span carries the tooltip. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(!delinquencyActions.open.enabled && "cursor-not-allowed")}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={!delinquencyActions.open.enabled}
                      onClick={() => setOpenNoticeOpen(true)}
                    >
                      {t("openDelinquency")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{openDelinquencyHint}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  {delinquencyActions.track.enabled ? (
                    <Button variant="outline-primary" size="sm" asChild>
                      <Link href={delinquencyActions.track.href}>{t("trackDelinquencies")}</Link>
                    </Button>
                  ) : (
                    <span className="cursor-not-allowed">
                      <Button variant="outline-primary" size="sm" disabled>
                        {t("trackDelinquencies")}
                      </Button>
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent>{trackDelinquenciesHint}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(!isDrafted && "cursor-not-allowed")}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={!isDrafted}
                      onClick={() => setCancelOpen(true)}
                    >
                      {t("cancelProposal")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("cancelProposalHint")}</TooltipContent>
              </Tooltip>
            </div>
            {/* Mobile: collapse into dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline-primary"
                  size="icon-sm"
                  className="sm:hidden"
                  aria-label={t("actionsMenu")}
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* No hover on touch, so the reason a row is disabled is printed inline. */}
                <DropdownMenuItem
                  disabled={!delinquencyActions.open.enabled}
                  onClick={() => setOpenNoticeOpen(true)}
                  className="flex-col items-start gap-0.5"
                >
                  {t("openDelinquency")}
                  {delinquencyActions.open.enabled ? null : (
                    <span className="text-muted-foreground text-xs">{openDelinquencyHint}</span>
                  )}
                </DropdownMenuItem>
                {delinquencyActions.track.enabled ? (
                  <DropdownMenuItem asChild>
                    <Link href={delinquencyActions.track.href}>{t("trackDelinquencies")}</Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
                    {t("trackDelinquencies")}
                    <span className="text-muted-foreground text-xs">{trackDelinquenciesHint}</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!isDrafted} onClick={() => setCancelOpen(true)}>
                  {t("cancelProposal")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <div className="flex flex-col gap-1">
            <Eyebrow className="font-medium">{t("idLabel")}</Eyebrow>
            <Mono className="text-foreground text-xl font-medium">{guarantee.id}</Mono>
          </div>
          <dl className="text-base-sm grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex items-center gap-3 sm:col-span-2">
              <dt className="text-muted-foreground">{t("currentStatus")}</dt>
              <dd>
                <GuaranteeStateTag state={guarantee.status}>
                  {tState(guarantee.status)}
                </GuaranteeStateTag>
              </dd>
            </div>
            {guarantee.closure && (
              <div className="flex flex-wrap items-baseline gap-3 sm:col-span-2">
                <dt className="text-muted-foreground">{t("closureReason")}</dt>
                <dd className="text-foreground">{tCloseReason(guarantee.closure.reason)}</dd>
              </div>
            )}
            <div className="flex flex-wrap items-baseline gap-3">
              <dt className="text-muted-foreground">{t("availableGuarantee")}</dt>
              <dd>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("guaranteeTooltipLabel")}
                      className="text-foreground hover:text-primary focus-visible:text-primary -mx-1 inline-flex items-baseline gap-1.5 px-1"
                    >
                      <Mono className="text-base font-medium">
                        {formatBRLCents(availableCapacityCents)}
                      </Mono>
                      <span className="text-muted-foreground text-xs">
                        {t("ofCeiling", {
                          ceiling: formatBRLCents(guarantee.capacity.ceilingCents),
                        })}
                      </span>
                      <span aria-hidden className="text-2xs text-muted-foreground">
                        ⓘ
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t("guaranteeTooltip")}</TooltipContent>
                </Tooltip>
              </dd>
            </div>
            <div className="flex items-center gap-3">
              <dt className="text-muted-foreground">{t("nextRenewal")}</dt>
              <dd>
                <Mono className="font-medium">{formatDateBR(guarantee.nextRenewalDate)}</Mono>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {delinquencyActions.open.enabled ? (
        <OpenNoticeSheet
          open={openNoticeOpen}
          agencyId={guarantee.agencyId}
          fixedGuaranteePublicId={guarantee.id}
          onClose={() => setOpenNoticeOpen(false)}
          onSuccess={() => setOpenNoticeOpen(false)}
        />
      ) : null}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelDialog.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel} disabled={isCanceling}>
              {isCanceling ? t("cancelDialog.canceling") : t("cancelDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
