import { MoreHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Mono } from "@/components/ui/mono";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import type { Contract, ContractStatus } from "@/lib/contracts/types";
import { StatusTag } from "./status-tag";

const statusTone: Record<ContractStatus, "accent" | "success" | "error" | "neutral"> = {
  ativo: "success",
  pendente: "accent",
  encerrado: "neutral",
  cancelado: "error",
};

const imobOutline =
  "border-primary text-primary bg-transparent hover:bg-accent-dim hover:text-primary aria-expanded:bg-accent-dim aria-expanded:text-primary";

export function ContractSummaryCard({ contract }: { contract: Contract }) {
  const t = useTranslations("contractDetails.summary");
  const tStatus = useTranslations("contractDetails.status");
  const isPending = contract.status === "pendente";

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          {/* Desktop: show all buttons inline */}
          <div className="hidden items-center gap-2 sm:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={imobOutline}>
                  {t("openDelinquency")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("openDelinquencyHint")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className={imobOutline}>
                  {t("trackDelinquencies")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("trackDelinquenciesHint")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn(!isPending && "cursor-not-allowed")}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isPending}
                    className={imobOutline}
                    aria-describedby="cancel-proposal-hint"
                  >
                    {t("cancelProposal")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent id="cancel-proposal-hint">{t("cancelProposalHint")}</TooltipContent>
            </Tooltip>
          </div>
          {/* Mobile: collapse into dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className={cn(imobOutline, "sm:hidden")}
                aria-label={t("actionsMenu")}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>{t("openDelinquency")}</DropdownMenuItem>
              <DropdownMenuItem>{t("trackDelinquencies")}</DropdownMenuItem>
              <DropdownMenuItem disabled={!isPending}>{t("cancelProposal")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-2xs text-muted-foreground font-mono font-medium tracking-[0.06em] uppercase">
            {t("idLabel")}
          </span>
          <Mono className="text-foreground text-xl font-medium">{contract.id}</Mono>
        </div>
        <dl className="text-base-sm grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("currentStatus")}</dt>
            <dd>
              <StatusTag
                tone={statusTone[contract.status]}
                label={tStatus(contract.status)}
                pulse={contract.status === "ativo"}
              />
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("nextRenewal")}</dt>
            <dd>
              <Mono className="font-medium">{formatDateBR(contract.nextRenewalDate)}</Mono>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-3 sm:col-span-2">
            <dt className="text-muted-foreground">{t("availableGuarantee")}</dt>
            <dd>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("guaranteeTooltipLabel")}
                    className="text-foreground hover:text-primary focus-visible:text-primary inline-flex items-baseline gap-1.5 transition-colors"
                  >
                    <Mono className="text-base font-medium">
                      {formatBRLCents(contract.availableGuaranteeCents)}
                    </Mono>
                    <span aria-hidden className="text-2xs text-muted-foreground">
                      ⓘ
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{t("guaranteeTooltip")}</TooltipContent>
              </Tooltip>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
