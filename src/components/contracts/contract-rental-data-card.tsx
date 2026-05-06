import { HomeIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatBRL } from "@/lib/contracts/format";
import type { Contract } from "@/lib/contracts/types";
import { ContractActionsMenu } from "./contract-actions-menu";
import { FieldGroupHeader, FieldRow } from "./field-row";

export function ContractRentalDataCard({ contract }: { contract: Contract }) {
  const t = useTranslations("contractDetails.rentalData");
  const tFields = useTranslations("contractDetails.rentalData.fields");
  const tGroups = useTranslations("contractDetails.rentalData.groups");
  const tKind = useTranslations("contractDetails.rentalData.propertyKind");

  const { rental, property, optional } = contract;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="font-mono text-xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
          {t("heading")}
        </CardTitle>
        <CardAction>
          <ContractActionsMenu />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-0 px-0 pb-0 lg:grid-cols-[auto_1fr]">
        <div className="flex items-center justify-center gap-3 border-b border-border px-6 py-3 sm:py-4 lg:flex-col lg:gap-2 lg:border-b-0 lg:border-r lg:py-6">
          <div className="flex size-12 shrink-0 items-center justify-center bg-secondary text-muted-foreground lg:size-20">
            <HomeIcon className="size-6 lg:size-10" strokeWidth={1.25} aria-hidden />
          </div>
          <span className="font-mono text-2xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
            {tKind(rental.propertyKind)}
          </span>
        </div>
        <dl className="flex flex-col">
          <FieldGroupHeader>{tGroups("contract")}</FieldGroupHeader>
          <FieldRow
            label={tFields("propertyKind")}
            value={tKind(rental.propertyKind)}
          />
          <FieldRow label={tFields("rent")} value={formatBRL(rental.rentBRL)} mono />
          <FieldRow label={tFields("condo")} value={formatBRL(rental.condoBRL)} mono />
          <FieldRow
            label={tFields("otherFees")}
            value={formatBRL(rental.otherFeesBRL)}
            mono
          />
          <FieldRow
            label={tFields("totalRent")}
            value={formatBRL(rental.totalRentBRL)}
            mono
          />
          <FieldRow label={tFields("fee")} value={formatBRL(rental.feeBRL)} mono />
          <FieldRow
            label={tFields("oneTimeActivationFee")}
            value={formatBRL(rental.oneTimeActivationFeeBRL)}
            mono
          />
          <FieldRow
            label={tFields("setupInstallments")}
            value={String(rental.setupInstallments)}
            mono
          />
          <FieldRow
            label={tFields("exitCost")}
            value={rental.exitCostMultiplier}
            mono
          />
          <FieldRow
            label={tFields("rentMultiplier")}
            value={rental.rentMultiplier}
            mono
          />
          <FieldRow label={tFields("payer")} value={rental.payer} />
          <FieldRow
            label={tFields("pviSchedule")}
            value={rental.pviMigrationSchedule ?? ""}
          />

          <FieldGroupHeader>{tGroups("property")}</FieldGroupHeader>
          <FieldRow label={tFields("cep")} value={property.cep} mono />
          <FieldRow
            label={tFields("addressNumber")}
            value={property.streetAndNumber}
          />
          <FieldRow
            label={tFields("neighborhood")}
            value={property.neighborhood}
          />
          <FieldRow label={tFields("cityUF")} value={property.cityUF} />

          <FieldGroupHeader>{tGroups("optional")}</FieldGroupHeader>
          <FieldRow
            label={tFields("complement")}
            value={optional.complement}
          />
          <FieldRow label={tFields("tag")} value={optional.tag} />
          <FieldRow
            label={tFields("description")}
            value={optional.description}
          />
        </dl>
      </CardContent>
    </Card>
  );
}
