"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId, InvitableRole } from "@convex/agencies/domain";
import { INVITABLE_ROLE } from "@convex/agencies/domain";

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

  function close() {
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
        toast.success(t("toasts.invited", { email: email.trim() }));
        close();
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
    submit,
    close,
  };
}
