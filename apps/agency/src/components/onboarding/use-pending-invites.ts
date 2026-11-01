"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyInviteId } from "@convex/agencies/domain";
import { useRouter } from "@mutav/i18n/navigation";
import { useWorkspace } from "@/providers/workspace";

export function usePendingInvites() {
  const t = useTranslations("onboarding.welcome.invites");
  const router = useRouter();
  const { currentUser } = useWorkspace();
  const invites = useQuery(api.agencies.members.listMyPendingInvites, currentUser ? {} : "skip");
  const acceptInviteMutation = useMutation(api.agencies.members.acceptInvite);
  const [acceptingId, setAcceptingId] = React.useState<AgencyInviteId | null>(null);

  async function accept(inviteId: AgencyInviteId, agencyName: string) {
    setAcceptingId(inviteId);
    try {
      const result = await acceptInviteMutation({ inviteId });
      if (!result.success) {
        toast.error(t(`errors.${result.error.code}`));
        return;
      }
      toast.success(t("accepted", { agency: agencyName }));
      // The (app) layout re-resolves the destination server-side from the new membership.
      router.push("/");
      router.refresh();
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setAcceptingId(null);
    }
  }

  return {
    invites: invites ?? [],
    hasInvites: (invites ?? []).length > 0,
    acceptingId,
    accept,
  };
}
