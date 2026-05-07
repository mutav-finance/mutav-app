"use client";

import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Mono } from "@/components/ui/mono";
import { formatDateTimeBR } from "@/lib/contracts/format";
import type { ContractHistoryEntry } from "@/lib/contracts/types";

export function ContractHistoryCard({ history }: { history: ContractHistoryEntry[] }) {
  const t = useTranslations("contractDetails.history");
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
            {t("heading")}
          </CardTitle>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={open ? t("collapse") : t("expand")}
              className="col-start-2 row-span-2 row-start-1 self-start justify-self-end"
            >
              {open ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-base-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.map((entry, idx) => (
                  <li
                    key={`${entry.at}-${idx}`}
                    className="border-border text-base-sm border-b pb-3 leading-relaxed last:border-b-0 last:pb-0"
                  >
                    <Mono className="text-muted-foreground mr-2">{formatDateTimeBR(entry.at)}</Mono>
                    {entry.message}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
