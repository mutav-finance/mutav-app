"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useWorkspace } from "@/providers/workspace";

export function SectionCards() {
  const t = useTranslations("metrics");
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id as Id<"agencies"> | undefined;

  const summary = useQuery(
    api.contracts.useCases.getPipelineSummary,
    agencyId ? { agencyId } : "skip",
  );

  const statuses = ["ativo", "pendente", "encerrado", "cancelado"] as const;

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {statuses.map((status) => (
        <Card key={status} className="@container/card">
          <CardHeader>
            <CardDescription>{t(`${status}.label`)}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {summary ? summary[status] : "—"}
            </CardTitle>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">{t(`${status}.footer`)}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
