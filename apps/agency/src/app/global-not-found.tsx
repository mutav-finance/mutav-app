import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import { NotFoundContent } from "@/components/not-found-content";
import "./globals.css";

// Next replaces the root layout with this module for /_not-found, so nothing
// wraps it: the fonts, globals.css, the <html>/<body> classes PublicShell's
// `h-full flex-1` needs, and the intl provider the client <Link> needs all
// have to be re-declared here.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("title"), description: t("description") };
}

export default async function GlobalNotFound() {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geist.variable} h-svh overflow-hidden antialiased`}
      suppressHydrationWarning
    >
      <body className="flex h-svh flex-col overflow-hidden">
        <NextIntlClientProvider>
          <BareShell brand={<Wordmark size="sm" />} dataFront="imobiliarias">
            <NotFoundContent />
          </BareShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
