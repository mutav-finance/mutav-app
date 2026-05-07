import { FileTextIcon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContractDocument, ContractDocumentKey, DocumentStatus } from "@/lib/contracts/types";
import { StatusTag } from "./status-tag";

const docKeys: ContractDocumentKey[] = ["rentalContract", "inspection", "policy"];

const statusTone: Record<DocumentStatus, "accent" | "neutral" | "success"> = {
  pendente: "accent",
  enviado: "neutral",
  aprovado: "success",
};

export function ContractDocumentsCard({ documents }: { documents: ContractDocument[] }) {
  const t = useTranslations("contractDetails.documents");
  const tLabels = useTranslations("contractDetails.documents.labels");
  const tStatus = useTranslations("contractDetails.documents.status");
  const byKey = new Map(documents.map((d) => [d.key, d]));

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {docKeys.map((key) => {
          const doc = byKey.get(key);
          const status = doc?.status ?? "pendente";
          return (
            <div key={key} className="border-border flex flex-col gap-3 border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <FileTextIcon
                    className="text-muted-foreground mt-0.5 size-4"
                    strokeWidth={1.25}
                    aria-hidden
                  />
                  <span className="text-base-sm font-medium">{tLabels(key)}</span>
                </div>
                <StatusTag tone={statusTone[status]} label={tStatus(status)} />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-primary text-primary hover:bg-accent-dim hover:text-primary self-start bg-transparent"
                      disabled
                    >
                      <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                      {t("send")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("sendDisabled")}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
