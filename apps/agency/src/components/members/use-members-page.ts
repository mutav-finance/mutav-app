"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyInviteId, MemberRole, MembershipId } from "@convex/agencies/domain";
import { canManageMembers } from "@convex/agencies/domain";
import { useWorkspace } from "@/providers/workspace";

export type MemberRow = FunctionReturnType<typeof api.agencies.members.listMembers>[number];
export type PendingInviteRow = FunctionReturnType<
  typeof api.agencies.members.listPendingInvites
>[number];

export function useMembersPage() {
  const t = useTranslations("members");
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;
  const canManage = selectedAgency ? canManageMembers(selectedAgency.role) : false;
  const isOwner = selectedAgency?.role === "owner";

  const members = useQuery(api.agencies.members.listMembers, agencyId ? { agencyId } : "skip");
  const invites = useQuery(
    api.agencies.members.listPendingInvites,
    agencyId && canManage ? { agencyId } : "skip",
  );

  const changeRoleMutation = useMutation(api.agencies.members.changeMemberRole);
  const removeMemberMutation = useMutation(api.agencies.members.removeMember);
  const revokeInviteMutation = useMutation(api.agencies.members.revokeInvite);

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pendingRemoval, setPendingRemoval] = React.useState<MemberRow | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Roles the caller may assign to someone else — admins never hand out ownership. */
  const assignableRoles: MemberRole[] = isOwner
    ? ["owner", "admin", "member"]
    : ["admin", "member"];

  /** Owners can edit anyone but themselves; admins cannot touch owners. */
  function canEdit(member: MemberRow): boolean {
    if (!canManage || member.isSelf) return false;
    return isOwner || member.role !== "owner";
  }

  async function changeRole(membershipId: MembershipId, role: MemberRole) {
    if (!agencyId) return;
    setBusy(true);
    try {
      const result = await changeRoleMutation({ agencyId, membershipId, role });
      if (result.success) toast.success(t("toasts.roleChanged"));
      else toast.error(t(`errors.${result.error.code}`));
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    if (!agencyId || !pendingRemoval) return;
    setBusy(true);
    try {
      const result = await removeMemberMutation({
        agencyId,
        membershipId: pendingRemoval.membershipId,
      });
      if (result.success) toast.success(t("toasts.removed"));
      else toast.error(t(`errors.${result.error.code}`));
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setBusy(false);
      setPendingRemoval(null);
    }
  }

  async function revokeInvite(inviteId: AgencyInviteId) {
    if (!agencyId) return;
    setBusy(true);
    try {
      const result = await revokeInviteMutation({ agencyId, inviteId });
      if (result.success) toast.success(t("toasts.revoked"));
      else toast.error(t(`errors.${result.error.code}`));
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setBusy(false);
    }
  }

  return {
    agencyId,
    members,
    invites: invites ?? [],
    isLoading: members === undefined,
    canManage,
    assignableRoles,
    canEdit,
    busy,
    changeRole,
    inviteOpen,
    openInvite: () => setInviteOpen(true),
    closeInvite: () => setInviteOpen(false),
    pendingRemoval,
    requestRemoval: (member: MemberRow) => setPendingRemoval(member),
    cancelRemoval: () => setPendingRemoval(null),
    confirmRemoval,
    revokeInvite,
  };
}
