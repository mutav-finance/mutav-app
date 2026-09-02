import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Providers } from "@/providers";
import { routing } from "@mutav/i18n/routing";
import "../globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["700"],
});

/**
 * Namespaces that cross to the client bundle. Everything else in the catalog
 * stays server-side: without this pick, next-intl inherits the whole catalog
 * from `src/i18n/request.ts` and serializes it into every page's HTML —
 * including the unauthenticated 404 at the root of this public origin.
 *
 * Derived from every `"use client"` component pay renders that translates:
 *   - `checkout`       checkout-pix-view, checkout-anchor-test-view
 *   - `paymentFlow`    copyable-{value,address,sep7-link},
 *                      payment-summary-header, horizon-payment-poller,
 *                      payment-address-paid-receipt
 *   - `paymentDetails` payment-summary-header (`paymentDetails.state`)
 *   - `common`         a11y strings shared by both trees
 *
 * `meta` is metadata-only and `notFound` renders in a server component, so
 * neither needs to reach the client. Nothing here is type-checked — a missing
 * namespace surfaces as a raw key at runtime, so add to this list whenever a
 * client component starts translating a new one.
 */
const CLIENT_NAMESPACES = ["common", "checkout", "paymentDetails", "paymentFlow"] as const;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const messages = await getMessages({ locale });
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.map((namespace) => [namespace, messages[namespace]]),
  );

  // Pay is a scroll-with-document app — every route is the tenant payment
  // flow, which prefers natural page scroll over a viewport-locked shell.
  // The PublicShell below provides the in-canvas scroll container.
  return (
    <html lang={locale} className={`${geist.variable} h-svh overflow-hidden antialiased`}>
      <body className="flex h-svh flex-col overflow-hidden">
        <NextIntlClientProvider messages={clientMessages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
