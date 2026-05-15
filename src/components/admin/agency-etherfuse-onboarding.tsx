"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { CopyIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { EtherfuseOnboardingStatus } from "@convex/agencies/domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useWorkspace } from "@/providers/workspace";

const DEV_ACTING_USER_PUBLIC_ID = "dev-user";

type Props = { agencyId: Id<"agencies"> };

type StatusToneMap = Record<
  EtherfuseOnboardingStatus,
  { variant: React.ComponentProps<typeof Badge>["variant"]; className?: string }
>;

const STATUS_TONE: StatusToneMap = {
  not_started: { variant: "secondary" },
  pending: {
    variant: "outline",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  approved: {
    variant: "outline",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  rejected: { variant: "destructive" },
  update_required: {
    variant: "outline",
    className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
};

export function AgencyEtherfuseOnboarding({ agencyId }: Props) {
  const t = useTranslations("admin.etherfuse");
  const { selectedAgency } = useWorkspace();
  const agency = useQuery(api.agencies.useCases.getById, { agencyId });
  const onboardAgency = useAction(api.anchors.actions.onboardAgency);
  const { copy } = useCopyToClipboard(t("orgId"));

  const [isOnboarding, setIsOnboarding] = React.useState(false);

  if (selectedAgency && selectedAgency.role !== "owner") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Forbidden — owner role required.</p>
        </CardContent>
      </Card>
    );
  }

  if (agency === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (agency === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Agency not found.</p>
        </CardContent>
      </Card>
    );
  }

  const status: EtherfuseOnboardingStatus = agency.etherfuseOnboardingStatus;
  const tone = STATUS_TONE[status];

  async function handleConnect() {
    setIsOnboarding(true);
    try {
      const result = await onboardAgency({
        agencyId,
        actingUserPublicId: DEV_ACTING_USER_PUBLIC_ID,
      });
      if (result.success) {
        toast.success(t("onboardingSuccess"));
      } else {
        toast.error(t("onboardingError", { message: result.message ?? result.error.code }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("onboardingError", { message }));
    } finally {
      setIsOnboarding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{agency.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <Badge variant={tone.variant} className={tone.className}>
            {t(`status.${status}`)}
          </Badge>
        </div>

        {agency.etherfuseOrgId && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("orgId")}
            </span>
            <div className="flex items-center gap-2">
              <Mono className="bg-muted/50 rounded-md px-2 py-1 text-xs">
                {agency.etherfuseOrgId}
              </Mono>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => copy(agency.etherfuseOrgId ?? "")}
                aria-label={t("orgId")}
              >
                <CopyIcon />
              </Button>
            </div>
          </div>
        )}

        {status === "not_started" && (
          <div>
            <Button type="button" onClick={handleConnect} disabled={isOnboarding}>
              {isOnboarding && <Loader2Icon className="animate-spin" />}
              {t("connect")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
