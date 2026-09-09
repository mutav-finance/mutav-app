import { useTranslations } from "next-intl";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { formatBRLCents, formatDateBR } from "@/lib/guarantees/format";
import type { GuaranteeTerms } from "@/lib/guarantees/types";
import { FieldGroup, FieldGroupHeader, FieldRow } from "./field-row";

function formatMultiplier(multiplier: number): string {
  return `${multiplier}x`;
}

/**
 * The priced terms of the guarantee: the snapshot copied from the product at
 * pricing time and never mutated afterwards. Editing the product moves no
 * figure on this card — that is the point of the snapshot.
 */
export function GuaranteeTermsCard({ terms }: { terms: GuaranteeTerms }) {
  const t = useTranslations("guaranteeDetails.terms");
  const tFields = useTranslations("guaranteeDetails.terms.fields");
  const tGroups = useTranslations("guaranteeDetails.terms.groups");
  const tPlan = useTranslations("guaranteeDetails.terms.plan");

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-0 pb-0">
        <FieldGroup className="gap-0">
          <FieldGroupHeader>{tGroups("product")}</FieldGroupHeader>
          <FieldRow label={tFields("product")} value={terms.productSlug} mono />
          <FieldRow label={tFields("plan")} value={tPlan(terms.plan)} />
          <FieldRow label={tFields("appliedAt")} value={formatDateBR(terms.appliedAt)} mono />

          <FieldGroupHeader>{tGroups("fees")}</FieldGroupHeader>
          <FieldRow label={tFields("fee")} value={formatBRLCents(terms.feeCents)} mono />
          <FieldRow label={tFields("taxaFee")} value={formatBRLCents(terms.taxaFeeCents)} mono />
          <FieldRow
            label={tFields("prestamistaFee")}
            value={formatBRLCents(terms.prestamistaFeeCents)}
            mono
          />
          <FieldRow
            label={tFields("activationFee")}
            value={formatBRLCents(terms.oneTimeActivationFeeCents)}
            mono
          />

          <FieldGroupHeader>{tGroups("coverage")}</FieldGroupHeader>
          <FieldRow
            label={tFields("ceilingMultiplier")}
            value={formatMultiplier(terms.coverageCeilingMultiplier)}
            mono
          />
          <FieldRow
            label={tFields("coverageCeiling")}
            value={formatBRLCents(terms.coverageCeilingCents)}
            mono
          />
          <FieldRow
            label={tFields("exitCostMultiplier")}
            value={formatMultiplier(terms.exitCostMultiplier)}
            mono
          />
          <FieldRow
            label={tFields("exitCostCap")}
            value={formatBRLCents(terms.exitCostCapCents)}
            mono
          />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
