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
import { cn } from "@/lib/utils";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import type { Contract, ContractStatus } from "@/lib/contracts/types";
import { api } from "@convex/_generated/api";
import { StatusTag } from "./status-tag";

const statusTone: Record<ContractStatus, "accent" | "success" | "error" | "neutral"> = {
  ativo: "success",
  pendente: "accent",
  encerrado: "neutral",
  cancelado: "error",
};

export function ContractSummaryCard({ contract }: { contract: Contract }) {
  const t = useTranslations("contractDetails.summary");
  const tStatus = useTranslations("contractDetails.status");
  const isPending = contract.status === "pendente";
  const cancelProposal = useMutation(api.contracts.useCases.cancelProposal);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);

  async function handleConfirmCancel() {
    setIsCancelling(true);
    try {
      const result = await cancelProposal({
        agencyId: contract.agencyId,
        publicId: contract.id,
      });
      if (result.success) {
        setCancelOpen(false);
      } else {
        toast.error(t(`errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setIsCancelling(false);
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline-primary" size="sm">
                    {t("openDelinquency")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("openDelinquencyHint")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline-primary" size="sm">
                    {t("trackDelinquencies")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("trackDelinquenciesHint")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(!isPending && "cursor-not-allowed")}>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={!isPending}
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
                <DropdownMenuItem>{t("openDelinquency")}</DropdownMenuItem>
                <DropdownMenuItem>{t("trackDelinquencies")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!isPending} onClick={() => setCancelOpen(true)}>
                  {t("cancelProposal")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <div className="flex flex-col gap-1">
            <Eyebrow className="font-medium">{t("idLabel")}</Eyebrow>
            <Mono className="text-foreground text-xl font-medium">{contract.id}</Mono>
          </div>
          <dl className="text-base-sm grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex items-center gap-3 sm:col-span-2">
              <dt className="text-muted-foreground">{t("currentStatus")}</dt>
              <dd>
                <StatusTag
                  tone={statusTone[contract.status]}
                  label={tStatus(contract.status)}
                  pulse={contract.status === "ativo"}
                />
              </dd>
            </div>
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
                        {formatBRLCents(contract.availableGuaranteeCents)}
                      </Mono>
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
                <Mono className="font-medium">{formatDateBR(contract.nextRenewalDate)}</Mono>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancelDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelDialog.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel} disabled={isCancelling}>
              {isCancelling ? t("cancelDialog.cancelling") : t("cancelDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
