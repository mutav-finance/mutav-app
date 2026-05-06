import { CheckIcon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { formatDateTimeBR } from "@/lib/contracts/format";
import type { ContractTenant } from "@/lib/contracts/types";
import { FieldGroupHeader, FieldRow } from "./field-row";
import { StatusTag } from "./status-tag";

const approvalTone: Record<
  ContractTenant["approvalStatus"],
  "accent" | "success" | "error"
> = {
  aprovado: "success",
  pendente: "accent",
  reprovado: "error",
};

export function ContractTenantCard({ tenant }: { tenant: ContractTenant }) {
  const t = useTranslations("contractDetails.tenant");
  const tFields = useTranslations("contractDetails.tenant.fields");
  const tApproval = useTranslations("contractDetails.tenant.approval");

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 border-b py-3">
        <div className="flex size-7 items-center justify-center bg-secondary text-muted-foreground">
          <UserIcon className="size-4" strokeWidth={1.25} />
        </div>
        <CardTitle className="font-mono text-xs font-medium tracking-[0.06em] uppercase text-muted-foreground">
          {t("heading")}
        </CardTitle>
        <StatusTag
          tone={approvalTone[tenant.approvalStatus]}
          label={tApproval(tenant.approvalStatus)}
          className="ml-auto"
        />
      </CardHeader>
      <CardContent className="grid gap-0 px-0 pb-0 lg:grid-cols-[auto_1fr]">
        <div className="flex items-start justify-center border-b border-border px-6 py-6 lg:border-b-0 lg:border-r">
          <div className="flex size-20 items-center justify-center bg-secondary text-muted-foreground">
            <UserIcon className="size-10" strokeWidth={1.25} />
          </div>
        </div>
        <dl className="flex flex-col">
          <FieldGroupHeader>{t("personal")}</FieldGroupHeader>
          <FieldRow label={tFields("fullName")} value={tenant.fullName} />
          <FieldRow label={tFields("cpf")} value={tenant.cpf} mono />
          <FieldRow
            label={tFields("birthDate")}
            value={tenant.birthDate}
            mono
          />
          <FieldRow label={tFields("email")} value={tenant.email} />
          <FieldRow label={tFields("phone")} value={tenant.phone} mono />
        </dl>
      </CardContent>
      {tenant.termApprovedAt && (
        <CardFooter className="gap-2 text-2xs text-muted-foreground">
          <CheckIcon
            className="size-4 text-success"
            strokeWidth={1.5}
            aria-hidden
          />
          <span className="font-medium uppercase tracking-[0.06em] font-mono">
            {t("termApproved")}
          </span>
          <span aria-hidden>·</span>
          <Mono>{formatDateTimeBR(tenant.termApprovedAt)}</Mono>
        </CardFooter>
      )}
    </Card>
  );
}
