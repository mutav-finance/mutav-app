import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateBR } from "@/lib/contracts/format";
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
        <CardTitle className="font-mono text-xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
          {t("heading")}
        </CardTitle>
        <CardAction className="flex flex-wrap items-center gap-2">
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
            <TooltipContent id="cancel-proposal-hint">
              {t("cancelProposalHint")}
            </TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
            {t("idLabel")}
          </span>
          <Mono className="text-xl font-medium text-foreground">
            {contract.id}
          </Mono>
        </div>
        <dl className="grid gap-3 text-base-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
              <Mono className="font-medium">
                {formatDateBR(contract.nextRenewalDate)}
              </Mono>
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
                    className="inline-flex items-baseline gap-1.5 text-foreground transition-colors hover:text-primary focus-visible:text-primary"
                  >
                    <Mono className="text-base font-medium">
                      {formatBRL(contract.availableGuaranteeBRL)}
                    </Mono>
                    <span aria-hidden className="text-2xs text-muted-foreground">
                      ⓘ
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {t("guaranteeTooltip")}
                </TooltipContent>
              </Tooltip>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
