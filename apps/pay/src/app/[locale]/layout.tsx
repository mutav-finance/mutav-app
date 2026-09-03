import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CLIENT_NAMESPACES } from "@/i18n/client-namespaces";
import { Providers } from "@/providers";
import { routing } from "@mutav/i18n/routing";
import "../globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["700"],
});

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
