"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { ArrearsWithoutClaimRow } from "@convex/delinquencies/expiry";
import { formatDateBR } from "@mutav/i18n/brazil";
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
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Mono } from "@mutav/ui/mono";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";

/**
 * Guarantees still in arrears with nothing open — usually because the agency
 * let the case expire. Nobody is chasing them, so a person decides here
 * whether the arrears is over and the guarantee returns to active.
 */
export function ArrearsWithoutClaim() {
  const t = useTranslations("defaults.arrearsWithoutClaim");
  const rows = useQuery(api.delinquencies.expiry.listArrearsWithoutClaim, {});
  const returnToActive = useMutation(api.delinquencies.expiry.staffReturnToActive);
  const [target, setTarget] = React.useState<ArrearsWithoutClaimRow | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      const result = await returnToActive({
        guaranteeId: target.guaranteeId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (result.success) {
        toast.success(t("returned"));
        setTarget(null);
        setNote("");
      } else {
        toast.error(t(`errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          {rows === undefined ? (
            <p className="text-muted-foreground text-base-sm">{t("loading")}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.tenant")}</TableHead>
                    <TableHead>{t("columns.agency")}</TableHead>
                    <TableHead>{t("columns.lastRent")}</TableHead>
                    <TableHead>{t("columns.closedAt")}</TableHead>
                    <TableHead className="text-right">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.guaranteeId}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{row.tenantName ?? "—"}</span>
                          <Mono className="text-muted-foreground text-xs">
                            {row.guaranteePublicId}
                          </Mono>
                        </div>
                      </TableCell>
                      <TableCell>{row.agencyName}</TableCell>
                      <TableCell>
                        {row.lastRentDueDate ? formatDateBR(row.lastRentDueDate) : "—"}
                      </TableCell>
                      <TableCell>
                        {row.lastClosedAt ? formatDateBR(row.lastClosedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setTarget(row)}>
                          {t("returnToActive")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </PageContent>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("back")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirm()}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
