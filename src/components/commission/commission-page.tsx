"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  TrendingUpIcon,
  FileTextIcon,
  DownloadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mono } from "@/components/ui/mono";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";

type CommissionRow = {
  contractId: string;
  tenantName: string;
  rentCents: number;
  commissionCents: number;
  installment: string;
  activatedAt: string;
};

const MOCK_ROWS: CommissionRow[] = [
  {
    contractId: "CTR-2T32IJ76",
    tenantName: "Ana Carolina Souza",
    rentCents: 274600,
    commissionCents: 4000,
    installment: "11/12",
    activatedAt: "06/06/2025",
  },
  {
    contractId: "CTR-8K91LM23",
    tenantName: "Bruno Henrique Lima",
    rentCents: 182000,
    commissionCents: 4000,
    installment: "9/12",
    activatedAt: "03/06/2025",
  },
  {
    contractId: "CTR-4P57QR85",
    tenantName: "Carla Mendes Pereira",
    rentCents: 175000,
    commissionCents: 4000,
    installment: "9/12",
    activatedAt: "03/06/2025",
  },
  {
    contractId: "CTR-7N34WX19",
    tenantName: "Diego Faria Costa",
    rentCents: 190100,
    commissionCents: 3800,
    installment: "8/12",
    activatedAt: "29/01/2025",
  },
  {
    contractId: "CTR-3M65YZ47",
    tenantName: "Elaine Cristina Rocha",
    rentCents: 165000,
    commissionCents: 3800,
    installment: "8/12",
    activatedAt: "10/09/2025",
  },
  {
    contractId: "CTR-6J21AB93",
    tenantName: "Felipe Santos Oliveira",
    rentCents: 204800,
    commissionCents: 4600,
    installment: "7/12",
    activatedAt: "30/10/2025",
  },
  {
    contractId: "CTR-1R78CD62",
    tenantName: "Gabriela Alves Martins",
    rentCents: 228300,
    commissionCents: 4600,
    installment: "7/12",
    activatedAt: "26/10/2025",
  },
  {
    contractId: "CTR-5S43EF11",
    tenantName: "Henrique Gomes Barros",
    rentCents: 180000,
    commissionCents: 5200,
    installment: "6/12",
    activatedAt: "09/11/2025",
  },
];

function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

export function CommissionPage() {
  const t = useTranslations("commission");
  const [month, setMonth] = React.useState(() => new Date());
  const [search, setSearch] = React.useState("");

  const filtered = MOCK_ROWS.filter(
    (r) =>
      r.contractId.toLowerCase().includes(search.toLowerCase()) ||
      r.tenantName.toLowerCase().includes(search.toLowerCase()),
  );

  const totalCommissionCents = filtered.reduce((sum, r) => sum + r.commissionCents, 0);
  const contractCount = filtered.length;

  function prevMonth() {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  function nextMonth() {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  function handleExport() {
    window.print();
  }

  const isCurrentMonth =
    month.getMonth() === new Date().getMonth() && month.getFullYear() === new Date().getFullYear();

  return (
    <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={prevMonth} aria-label={t("prevMonth")}>
          <ChevronLeftIcon className="size-4" strokeWidth={1.5} />
        </Button>
        <span className="text-base-sm min-w-40 text-center font-mono font-medium capitalize">
          {formatMonth(month)}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={nextMonth}
          disabled={isCurrentMonth}
          aria-label={t("nextMonth")}
        >
          <ChevronRightIcon className="size-4" strokeWidth={1.5} />
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
              {t("kpi.monthCommission")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-4 py-4">
            <div className="flex items-stretch gap-3">
              <div className="bg-secondary text-muted-foreground flex shrink-0 items-center justify-center rounded px-2">
                <TrendingUpIcon className="size-6" strokeWidth={1.25} />
              </div>
              <div className="flex flex-col gap-1">
                <Mono className="text-foreground text-2xl font-semibold">
                  {formatBRL(totalCommissionCents)}
                </Mono>
                <span className="text-muted-foreground text-sm">
                  {t("kpi.contracts", { count: contractCount })}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
              {t("kpi.invoice")}
            </CardTitle>
            <CardAction>
              <Button variant="ghost" size="icon-sm" disabled aria-label={t("kpi.invoiceDownload")}>
                <DownloadIcon className="size-4" strokeWidth={1.25} />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="bg-secondary flex size-10 items-center justify-center rounded">
              <FileTextIcon className="text-muted-foreground size-5" strokeWidth={1.25} />
            </div>
            <p className="text-base-sm text-muted-foreground font-medium">
              {t("kpi.invoiceEmpty")}
            </p>
            <p className="text-muted-foreground text-sm">{t("kpi.invoiceEmptyHint")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
            {t("table.heading")}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleExport}
              aria-label={t("table.export")}
            >
              <DownloadIcon className="size-4" strokeWidth={1.25} />
            </Button>
            <div className="relative w-full max-w-xs">
              <SearchIcon
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={1.25}
              />
              <Input
                placeholder={t("table.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <div className="border-border rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.col.contract")}</TableHead>
                <TableHead>{t("table.col.tenant")}</TableHead>
                <TableHead className="text-right">{t("table.col.rent")}</TableHead>
                <TableHead className="text-right">{t("table.col.commission")}</TableHead>
                <TableHead className="text-center">{t("table.col.installment")}</TableHead>
                <TableHead>{t("table.col.activatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <TableRow key={row.contractId}>
                    <TableCell>
                      <Link
                        href={`/contracts/${row.contractId}`}
                        className="text-primary hover:text-primary/80 font-mono text-sm font-medium transition-colors"
                      >
                        {row.contractId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-base-sm">{row.tenantName}</TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm">{formatBRL(row.rentCents)}</Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm font-semibold">
                        {formatBRL(row.commissionCents)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-center">
                      <Mono className="text-muted-foreground text-sm">{row.installment}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-muted-foreground text-sm">{row.activatedAt}</Mono>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
