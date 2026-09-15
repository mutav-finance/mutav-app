import { useTranslations } from "next-intl";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { formatBRLCents } from "@mutav/i18n/brazil";
import type { GuaranteeLease } from "@/lib/guarantees/types";
import { GuaranteeActionsMenu } from "./guarantee-actions-menu";
import { FieldGroup, FieldGroupHeader, FieldRow } from "./field-row";

/**
 * The lease the guarantee covers: the living rental relationship. Everything
 * here belongs to the `leases` row and can change while the guarantee's
 * `terms` snapshot stays frozen — the two are deliberately separate cards.
 */
export function GuaranteeLeaseCard({ lease }: { lease: GuaranteeLease }) {
  const t = useTranslations("guaranteeDetails.lease");
  const tFields = useTranslations("guaranteeDetails.lease.fields");
  const tGroups = useTranslations("guaranteeDetails.lease.groups");
  const tKind = useTranslations("guaranteeDetails.lease.propertyKind");
  const tPayer = useTranslations("guaranteeDetails.lease.payer");

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
        <CardAction>
          <GuaranteeActionsMenu />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-0 pb-0">
        <FieldGroup className="gap-0">
          <FieldGroupHeader>{tGroups("rental")}</FieldGroupHeader>
          <FieldRow label={tFields("propertyKind")} value={tKind(lease.propertyKind)} />
          <FieldRow label={tFields("rent")} value={formatBRLCents(lease.rent.rentCents)} mono />
          <FieldRow label={tFields("condo")} value={formatBRLCents(lease.rent.condoCents)} mono />
          <FieldRow
            label={tFields("otherFees")}
            value={formatBRLCents(lease.rent.otherFeesCents)}
            mono
          />
          <FieldRow
            label={tFields("totalRent")}
            value={formatBRLCents(lease.rent.totalRentCents)}
            mono
          />
          <FieldRow label={tFields("payer")} value={tPayer(lease.payer)} />

          <FieldGroupHeader>{tGroups("property")}</FieldGroupHeader>
          <FieldRow label={tFields("cep")} value={lease.property.cep} mono />
          <FieldRow label={tFields("addressNumber")} value={lease.property.streetAndNumber} />
          <FieldRow label={tFields("neighborhood")} value={lease.property.neighborhood} />
          <FieldRow label={tFields("cityUF")} value={lease.property.cityUF} />

          <FieldGroupHeader>{tGroups("optional")}</FieldGroupHeader>
          <FieldRow label={tFields("complement")} value={lease.property.complement} />
          <FieldRow label={tFields("tag")} value={lease.tag} />
          <FieldRow label={tFields("description")} value={lease.description} />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
