"use client";

import { useLocale, useTranslations } from "next-intl";
import { Badge } from "../badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Mono } from "../mono";
import { Skeleton } from "../skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../table";
import { formatAssetAmount, formatPercent } from "./format";
import type { ReserveCoverageInput } from "./types";

/**
 * Where the reserve's capital sits: idle in the vault or deployed to each
 * strategy, flagged stable (counts toward solvency) or volatile (does not).
 * Shared by the agency `/transparency` page and the admin `/treasury` screen;
 * reads the `transparency.breakdown` namespace.
 */
export function ReserveBreakdown({ coverage }: { coverage: ReserveCoverageInput }) {
  const t = useTranslations("transparency.breakdown");
  const locale = useLocale();
  const loading = coverage === null || coverage === undefined;
  const solvency = coverage?.available ? coverage.solvency : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {t("title")}
          {solvency?.network === "testnet" ? <Badge variant="outline">{t("testnet")}</Badge> : null}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : !solvency ? (
          <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.position")}</TableHead>
                <TableHead>{t("columns.contract")}</TableHead>
                <TableHead>{t("columns.solvency")}</TableHead>
                <TableHead className="text-right">{t("columns.balance")}</TableHead>
                <TableHead className="text-right">{t("columns.share")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {solvency.positions.map((position) => (
                <TableRow key={`${position.kind}:${position.address}`}>
                  <TableCell>
                    {position.kind === "idle"
                      ? t("kind.idle", { symbol: solvency.assetSymbol })
                      : t("kind.strategy")}
                  </TableCell>
                  <TableCell>
                    <a
                      href={position.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      <Mono className="text-xs">{shortContractId(position.address)}</Mono>
                    </a>
                  </TableCell>
                  <TableCell>{position.volatile ? t("volatile") : t("stable")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAssetAmount(locale, position.balance, solvency.assetSymbol)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {position.share === null ? "—" : formatPercent(locale, position.share)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const CONTRACT_ID_EDGE = 6;

// The full id stays one click away (explorer link, and the reserve panel prints
// the three reserve ids in full); in a table column the middle is noise.
function shortContractId(id: string): string {
  if (id.length <= CONTRACT_ID_EDGE * 2 + 1) return id;
  return `${id.slice(0, CONTRACT_ID_EDGE)}…${id.slice(-CONTRACT_ID_EDGE)}`;
}
