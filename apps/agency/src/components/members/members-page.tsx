"use client";

import { useTranslations } from "next-intl";
import { MailPlusIcon, Trash2Icon, XIcon } from "lucide-react";
import type { MemberRole } from "@convex/agencies/domain";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mutav/ui/alert-dialog";
import { Badge } from "@mutav/ui/badge";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { formatDateBR } from "@mutav/i18n/brazil";
import { InviteMemberSheet } from "@/components/members/invite-member-sheet";
import { useMembersPage } from "@/components/members/use-members-page";

const ROLE_VALUES = {
  owner: "owner",
  admin: "admin",
  member: "member",
} as const satisfies Record<MemberRole, MemberRole>;

function isMemberRole(value: string): value is MemberRole {
  return value in ROLE_VALUES;
}

export function MembersPage() {
  const t = useTranslations("members");
  const vm = useMembersPage();

  return (
    <div className="flex flex-col gap-8 px-4 py-4 lg:px-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow as="h2" size="xs" className="font-medium">
            {t("table.heading")}
          </Eyebrow>
          {vm.canManage ? (
            <Button size="sm" onClick={vm.openInvite}>
              <MailPlusIcon className="size-4" strokeWidth={1.5} />
              {t("actions.invite")}
            </Button>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.email")}</TableHead>
                <TableHead>{t("table.role")}</TableHead>
                <TableHead>{t("table.joined")}</TableHead>
                {vm.canManage ? (
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vm.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {t("table.loading")}
                  </TableCell>
                </TableRow>
              ) : null}
              {vm.members?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              ) : null}
              {vm.members?.map((member) => (
                <TableRow key={member.membershipId}>
                  <TableCell className="font-medium">
                    {member.name}
                    {member.isSelf ? (
                      <span className="text-muted-foreground ml-2 text-xs">({t("table.you")})</span>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    {vm.canEdit(member) ? (
                      <Select
                        value={member.role}
                        disabled={vm.busy}
                        onValueChange={(value) => {
                          if (isMemberRole(value)) void vm.changeRole(member.membershipId, value);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-40"
                          aria-label={t("actions.changeRoleLabel", { name: member.name })}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {vm.assignableRoles.map((role) => (
                            <SelectItem key={role} value={role}>
                              {t(`roles.${role}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{t(`roles.${member.role}`)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {formatDateBR(member.joinedAt)}
                  </TableCell>
                  {vm.canManage ? (
                    <TableCell className="text-right">
                      {vm.canEdit(member) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={vm.busy}
                          onClick={() => vm.requestRemoval(member)}
                        >
                          <Trash2Icon className="size-4" strokeWidth={1.5} />
                          {t("actions.remove")}
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {vm.canManage ? (
        <section className="flex flex-col gap-3">
          <Eyebrow as="h2" size="xs" className="font-medium">
            {t("invites.heading")}
          </Eyebrow>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invites.email")}</TableHead>
                  <TableHead>{t("invites.role")}</TableHead>
                  <TableHead>{t("invites.invitedBy")}</TableHead>
                  <TableHead>{t("invites.expires")}</TableHead>
                  <TableHead className="text-right">{t("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground text-center">
                      {t("invites.empty")}
                    </TableCell>
                  </TableRow>
                ) : null}
                {vm.invites.map((invite) => (
                  <TableRow key={invite.inviteId}>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`roles.${invite.role}`)}</Badge>
                    </TableCell>
                    <TableCell>{invite.invitedByName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatDateBR(invite.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={vm.busy}
                        onClick={() => void vm.revokeInvite(invite.inviteId)}
                      >
                        <XIcon className="size-4" strokeWidth={1.5} />
                        {t("invites.revoke")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {vm.agencyId ? (
        <InviteMemberSheet open={vm.inviteOpen} agencyId={vm.agencyId} onClose={vm.closeInvite} />
      ) : null}

      <AlertDialog
        open={vm.pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) vm.cancelRemoval();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeDialog.description", { name: vm.pendingRemoval?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={vm.busy}>{t("removeDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={vm.busy} onClick={() => void vm.confirmRemoval()}>
              {t("removeDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
