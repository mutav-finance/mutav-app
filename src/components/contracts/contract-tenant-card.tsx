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

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
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
        <div className="flex size-7 items-center justify-center bg-secondary text-muted-foreground">
          <UserIcon className="size-4" strokeWidth={1.25} aria-hidden />
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
        <div className="flex items-center justify-center border-b border-border px-6 py-3 sm:py-4 lg:py-6 lg:border-b-0 lg:border-r">
          <div
            className="flex size-12 shrink-0 items-center justify-center bg-secondary lg:size-20"
            role="img"
            aria-label={t("initialsLabel")}
          >
            <Mono className="text-base font-medium text-foreground lg:text-xl">
              {getInitials(tenant.fullName)}
            </Mono>
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
      {isRejected && (
        <CardFooter className="border-t border-border px-6 py-3 text-base-sm text-destructive">
          {t("approvalFailedHelp")}
        </CardFooter>
      )}
      {!isRejected && tenant.termApprovedAt && (
        <CardFooter className="gap-2 px-6 py-3 text-2xs text-muted-foreground">
          <CheckIcon
            className="size-4 text-success"
            strokeWidth={1.25}
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
