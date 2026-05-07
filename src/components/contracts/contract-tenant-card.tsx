import { CheckIcon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { formatDateTimeBR } from "@/lib/contracts/format";
import type { ContractTenant } from "@/lib/contracts/types";
import { FieldGroupHeader, FieldRow } from "./field-row";
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
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
        <StatusTag
          tone={approvalTone[tenant.approvalStatus]}
          label={tApproval(tenant.approvalStatus)}
          className="ml-auto"
        />
      </CardHeader>
      <CardContent className="grid gap-0 px-0 pb-0 lg:grid-cols-[auto_1fr]">
        <div className="border-border flex items-center justify-center border-b px-6 py-3 sm:py-4 lg:border-r lg:border-b-0 lg:py-6">
          <div
            className="bg-secondary flex size-12 shrink-0 items-center justify-center lg:size-20"
            role="img"
            aria-label={t("initialsLabel")}
          >
            <Mono className="text-foreground text-base font-medium lg:text-xl">
              {getInitials(tenant.fullName)}
            </Mono>
          </div>
        </div>
        <dl className="flex flex-col">
          <FieldGroupHeader>{t("personal")}</FieldGroupHeader>
          <FieldRow label={tFields("fullName")} value={tenant.fullName} />
          <FieldRow label={tFields("cpf")} value={tenant.cpf} mono />
          <FieldRow label={tFields("birthDate")} value={tenant.birthDate} mono />
          <FieldRow label={tFields("email")} value={tenant.email} />
          <FieldRow label={tFields("phone")} value={tenant.phone} mono />
        </dl>
      </CardContent>
      {isRejected && (
        <CardFooter className="border-border text-base-sm text-destructive border-t px-6 py-3">
          {t("approvalFailedHelp")}
        </CardFooter>
      )}
      {!isRejected && tenant.termApprovedAt && (
        <CardFooter className="text-2xs text-muted-foreground gap-2 px-6 py-3">
          <CheckIcon className="text-success size-4" strokeWidth={1.25} aria-hidden />
          <span className="font-mono font-medium tracking-[0.06em] uppercase">
            {t("termApproved")}
          </span>
          <span aria-hidden>·</span>
          <Mono>{formatDateTimeBR(tenant.termApprovedAt)}</Mono>
        </CardFooter>
      )}
    </Card>
  );
}
