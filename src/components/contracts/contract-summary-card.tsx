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
import { formatBRL, formatDateBR } from "@/lib/contracts/format";
import type { Contract, ContractStatus } from "@/lib/contracts/types";
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

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="font-mono text-xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
          {t("heading")}
        </CardTitle>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm">
            {t("openDelinquency")}
          </Button>
          <Button variant="outline" size="sm">
            {t("trackDelinquencies")}
          </Button>
          <Button variant="outline" size="sm" disabled>
            {t("cancelProposal")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 py-2">
        <div className="font-display text-3xl font-bold tracking-tight text-foreground">
          <Mono>{contract.id}</Mono>
        </div>
        <dl className="grid gap-3 text-base-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("currentStatus")}</dt>
            <dd>
              <StatusTag
                tone={statusTone[contract.status]}
                label={tStatus(contract.status)}
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
              <Mono className="text-base font-medium text-foreground">
                {formatBRL(contract.availableGuaranteeBRL)}
              </Mono>
            </dd>
          </div>
        </dl>
        <p className="text-2xs text-muted-foreground">
          * {t("guaranteeTooltip")}
        </p>
      </CardContent>
    </Card>
  );
}
