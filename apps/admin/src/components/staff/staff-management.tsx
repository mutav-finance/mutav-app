"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import type { MutavStaffRole } from "@convex/mutavStaff/domain";
import { MUTAV_STAFF_ROLE } from "@convex/mutavStaff/domain";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Badge } from "@mutav/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@mutav/ui/alert-dialog";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useStaffManagement, type StaffRow } from "@/hooks/use-staff-management";

const ROLE_OPTIONS: MutavStaffRole[] = [
  MUTAV_STAFF_ROLE.SUPPORT,
  MUTAV_STAFF_ROLE.COMPLIANCE,
  MUTAV_STAFF_ROLE.ADMIN,
  MUTAV_STAFF_ROLE.TREASURY,
];

export function StaffManagement({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.mutavStaff.useCases.listAllStaff>;
}) {
  const t = useTranslations("staff");
  const vm = useStaffManagement({ preloaded });

  return (
    <PageShell>
      <PageHeader
        variant="section"
        title={t("title")}
        subtitle={t("subtitle")}
        actions={<AddStaffDialog vm={vm} />}
      />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          {vm.rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("empty")}</p>
          ) : (
            <StaffTable rows={vm.rows} vm={vm} />
          )}
        </div>
      </PageContent>
      <RemoveStaffDialog vm={vm} />
    </PageShell>
  );
}

function StaffTable({ rows, vm }: { rows: StaffRow[]; vm: ReturnType<typeof useStaffManagement> }) {
  const t = useTranslations("staff");
  const locale = useLocale();
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.auth0Sub")}</TableHead>
          <TableHead>{t("columns.role")}</TableHead>
          <TableHead>{t("columns.createdAt")}</TableHead>
          <TableHead>{t("columns.addedBy")}</TableHead>
          <TableHead className="w-0">{t("columns.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.staffId}>
            <TableCell className="font-mono text-xs">{row.auth0Sub || t("notAvailable")}</TableCell>
            <TableCell>
              <Badge variant="secondary">{t(`roles.${row.role}`)}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground text-base-sm">
              {formatter.format(new Date(row.createdAt))}
            </TableCell>
            <TableCell className="text-muted-foreground text-base-sm">
              {row.addedByName ?? t("addedByFallback")}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => vm.remove.setTarget({ auth0Sub: row.auth0Sub, role: row.role })}
                disabled={!row.auth0Sub}
                aria-label={t("actions.remove")}
              >
                <Trash2Icon />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AddStaffDialog({ vm }: { vm: ReturnType<typeof useStaffManagement> }) {
  const t = useTranslations("staff");
  return (
    <AlertDialog open={vm.add.open} onOpenChange={vm.add.setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          {t("actions.add")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialog.addTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("dialog.addDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-base-sm font-medium">{t("dialog.auth0SubLabel")}</span>
            <Input
              value={vm.add.auth0Sub}
              onChange={(event) => vm.add.setAuth0Sub(event.target.value)}
              placeholder={t("dialog.auth0SubPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-base-sm font-medium">{t("dialog.roleLabel")}</span>
            <Select
              value={vm.add.role}
              onValueChange={(value) => vm.add.setRole(value as MutavStaffRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={vm.add.busy}>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={vm.add.busy || !vm.add.auth0Sub.trim()}
            onClick={(event) => {
              event.preventDefault();
              vm.add.submit();
            }}
          >
            {t("dialog.submit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveStaffDialog({ vm }: { vm: ReturnType<typeof useStaffManagement> }) {
  const t = useTranslations("staff");
  const open = vm.remove.target !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) vm.remove.setTarget(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialog.removeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("dialog.removeDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        {vm.remove.target && (
          <div className="text-muted-foreground text-base-sm">
            <span className="font-mono">{vm.remove.target.auth0Sub}</span>
            {" · "}
            <span>{t(`roles.${vm.remove.target.role}`)}</span>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={vm.remove.busy}>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={vm.remove.busy}
            onClick={(event) => {
              event.preventDefault();
              vm.remove.confirm();
            }}
          >
            {t("actions.confirmRemove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
