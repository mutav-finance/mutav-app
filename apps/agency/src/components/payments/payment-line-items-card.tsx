import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@mutav/ui/mono";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { formatBRLCents } from "@/lib/contracts/format";
import type { Payment } from "@convex/payments/domain";

export function PaymentLineItemsCard({ payment }: { payment: Payment }) {
  const t = useTranslations("paymentDetails.lineItems");

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {payment.lineItems.length === 0 ? (
          <p className="text-muted-foreground px-6 py-4 text-sm">{t("empty")}</p>
        ) : (
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead>{t("columns.contract")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.description")}</TableHead>
                <TableHead className="text-right">{t("columns.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payment.lineItems.map((item, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <Link
                      href={`/contracts/${item.contractPublicId}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {item.contractPublicId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-xs">
                      {t(`kind.${item.kind}` as "kind.recurring" | "kind.activation")}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {item.description}
                  </TableCell>
                  <TableCell className="text-right">
                    <Mono className="text-sm">{formatBRLCents(item.amountCents)}</Mono>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  {t("total")}
                </TableCell>
                <TableCell className="text-right">
                  <Mono className="font-semibold">{formatBRLCents(payment.totalCents)}</Mono>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
