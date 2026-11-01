"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId, InvitableRole } from "@convex/agencies/domain";
import { INVITABLE_ROLE } from "@convex/agencies/domain";

/**
 * Where an invitee signs in to accept. Invites are matched by email on the
 * welcome screen, so the link is the same for every invite; it is shown after
 * every invite so the inviter can share it when email is not configured.
 */
export function inviteAcceptLink(origin: string): string {
  return `${origin}/onboarding`;
}

export type SentInvite = { email: string; emailQueued: boolean; link: string };

export const INVITABLE_ROLES: readonly InvitableRole[] = [
  INVITABLE_ROLE.MEMBER,
  INVITABLE_ROLE.ADMIN,
];

export function isInvitableRole(value: string): value is InvitableRole {
  return INVITABLE_ROLES.some((role) => role === value);
}

export function useInviteMemberSheet({
  agencyId,
  onClose,
}: {
  agencyId: AgencyId;
  onClose: () => void;
}) {
  const t = useTranslations("members");
  const inviteMember = useMutation(api.agencies.members.inviteMember);

  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<InvitableRole>(INVITABLE_ROLE.MEMBER);
  const [emailError, setEmailError] = React.useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState<SentInvite | null>(null);

  function close() {
    setSent(null);
    setEmail("");
    setRole(INVITABLE_ROLE.MEMBER);
    setEmailError(undefined);
    onClose();
  }

  async function submit() {
    if (!email.trim()) {
      setEmailError(t("errors.INVALID_EMAIL"));
      return;
    }
    setSubmitting(true);
    try {
      const result = await inviteMember({ agencyId, email, role });
      if (result.success) {
        const invitedEmail = email.trim();
        const { emailQueued } = result.data;
        if (emailQueued) toast.success(t("toasts.invited", { email: invitedEmail }));
        else toast.success(t("toasts.inviteCreated", { email: invitedEmail }));
        setSent({
          email: invitedEmail,
          emailQueued,
          link: inviteAcceptLink(window.location.origin),
        });
        return;
      }
      if (result.error.code === "INVALID_EMAIL") {
        setEmailError(t("errors.INVALID_EMAIL"));
        return;
      }
      toast.error(t(`errors.${result.error.code}`));
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    email,
    setEmail: (value: string) => {
      setEmail(value);
      setEmailError(undefined);
    },
    role,
    selectRole: (value: string) => {
      if (isInvitableRole(value)) setRole(value);
    },
    roles: INVITABLE_ROLES,
    emailError,
    submitting,
    sent,
    submit,
    close,
  };
}
