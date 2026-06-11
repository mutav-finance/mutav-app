import { CheckIcon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@mutav/ui/card";
import { Mono } from "@mutav/ui/mono";
import { formatDateBR, formatDateTimeBR } from "@/lib/contracts/format";
import type { ContractTenant } from "@/lib/contracts/types";
import { FieldGroup, FieldGroupHeader, FieldRow } from "./field-row";
import { StatusTag } from "./status-tag";

const approvalTone: Record<ContractTenant["approvalStatus"], "accent" | "success" | "error"> = {
  aprovado: "success",
  pendente: "accent",
  reprovado: "error",
};

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function ContractTenantCard({ tenant }: { tenant: ContractTenant }) {
  const t = useTranslations("contractDetails.tenant");
  const tFields = useTranslations("contractDetails.tenant.fields");
  const tApproval = useTranslations("contractDetails.tenant.approval");
  const isRejected = tenant.approvalStatus === "reprovado";

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 border-b py-3">
        <div className="bg-secondary text-muted-foreground flex size-7 items-center justify-center">
          <UserIcon className="size-4" strokeWidth={1.25} aria-hidden />
        </div>
        <Eyebrow as={CardTitle} className="text-muted-foreground text-xs font-medium">
          {t("heading")}
        </Eyebrow>
        <StatusTag
          tone={approvalTone[tenant.approvalStatus]}
          label={tApproval(tenant.approvalStatus)}
          className="ml-auto"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-0 pb-0">
        <div className="border-border flex items-center justify-center border-b px-6 py-3 sm:py-4">
          <div
            className="bg-secondary flex size-12 shrink-0 items-center justify-center"
            role="img"
            aria-label={t("initialsLabel")}
          >
            <Mono className="text-foreground text-base font-medium">
              {getInitials(tenant.fullName)}
            </Mono>
          </div>
        </div>
        <FieldGroup className="gap-0">
          <FieldGroupHeader>{t("personal")}</FieldGroupHeader>
          <FieldRow label={tFields("fullName")} value={tenant.fullName} />
          <FieldRow label={tFields("cpf")} value={tenant.cpf} mono />
          <FieldRow label={tFields("birthDate")} value={formatDateBR(tenant.birthDate)} mono />
          <FieldRow label={tFields("email")} value={tenant.email} />
          <FieldRow label={tFields("phone")} value={tenant.phone} mono />
        </FieldGroup>
      </CardContent>
      {isRejected && (
        <CardFooter className="border-border text-base-sm text-destructive border-t px-6 py-3">
          {t("approvalFailedHelp")}
        </CardFooter>
      )}
      {!isRejected && tenant.termApprovedAt && (
        <CardFooter className="text-2xs text-muted-foreground gap-2 px-6 py-3">
          <CheckIcon className="text-success size-4" strokeWidth={1.25} aria-hidden />
          <Eyebrow className="text-2xs text-muted-foreground font-medium">
            {t("termApproved")}
          </Eyebrow>
          <span aria-hidden>·</span>
          <Mono>{formatDateTimeBR(tenant.termApprovedAt)}</Mono>
        </CardFooter>
      )}
    </Card>
  );
}
