"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader } from "@mutav/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import { GUARANTEE_STATES } from "@convex/guarantees/domain";
import type { GuaranteeState } from "@/lib/guarantees/types";
import { GuaranteeStateTag } from "./state-tag";

type Props = {
  heading: string;
  counts: Record<GuaranteeState, number> | null | undefined;
};

/**
 * One figure per lifecycle state. The five in-force states do not collapse
 * into "active": a guarantee in arrears, one whose default is verified and one
 * under committed cover are all covering, and each means something different
 * to the agency — so each keeps its own count instead of being summed away.
 */
export function GuaranteeStateBreakdown({ heading, counts }: Props) {
  const tState = useTranslations("guaranteeDetails.state");
  const isLoading = counts === null || counts === undefined;

  return (
    <Card>
      <CardHeader>
        <CardDescription>{heading}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {GUARANTEE_STATES.map((state) => (
            <div key={state} className="flex flex-col items-start gap-1.5">
              <dt>
                <GuaranteeStateTag state={state}>{tState(state)}</GuaranteeStateTag>
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {isLoading ? <Skeleton className="h-8 w-8" /> : counts[state]}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
