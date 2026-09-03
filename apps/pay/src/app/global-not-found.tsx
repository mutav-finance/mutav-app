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
    <html lang={locale} className={`${geist.variable} h-svh overflow-hidden antialiased`}>
      <body className="flex h-svh flex-col overflow-hidden">
        {/*
          Explicit (empty) messages, not the default. Left undefined,
          NextIntlClientProvider falls back to `await getMessages()` and
          inlines the whole catalog into this page's HTML — the leak #307
          closed for [locale]/layout.tsx but not for this route, which is the
          unauthenticated 404 on a public, Auth0-free origin. Nothing under
          this provider translates in the browser: NotFoundContent, BareShell
          and Wordmark are all server-rendered, and the client <Link> needs
          the provider for the locale, not for copy. A client component added
          here must take its strings as props or extend this pick.
        */}
        <NextIntlClientProvider messages={{}}>
          <BareShell brand={<Wordmark variant="display" size="md" />} dataFront="imobiliarias">
            <NotFoundContent />
          </BareShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
