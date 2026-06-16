import { DownloadIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";
import type { ContractDocument, ContractDocumentKey, DocumentStatus } from "@/lib/contracts/types";
import { StatusTag } from "./status-tag";

const docKeys: ContractDocumentKey[] = ["rentalContract", "inspection", "policy"];
const keysWithTemplate = new Set<ContractDocumentKey>(["rentalContract", "inspection"]);

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
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {docKeys.map((key) => {
          const doc = byKey.get(key);
          const status = doc?.status ?? "pendente";
          return (
            <div key={key} className="border-border flex flex-col gap-3 rounded border p-4">
              <div className="flex items-start gap-2">
                <FileTextIcon
                  className="text-muted-foreground mt-0.5 size-4"
                  strokeWidth={1.25}
                  aria-hidden
                />
                <span className="text-base-sm font-medium">{tLabels(key)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button variant="outline-primary" size="sm" className="self-start" disabled>
                          <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                          {t("send")}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("sendDisabled")}</TooltipContent>
                  </Tooltip>
                  {keysWithTemplate.has(key) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" className="self-start" asChild>
                          <a href={`/templates/${key}.pdf`} download>
                            <DownloadIcon className="size-4" strokeWidth={1.25} aria-hidden />
                            <span className="sr-only">{t("downloadTemplate")}</span>
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("downloadTemplate")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <StatusTag tone={statusTone[status]} label={tStatus(status)} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
