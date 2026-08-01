import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Providers } from "@/providers";
import { routing } from "@mutav/i18n/routing";
import "../globals.css";

// `--font-display` / `--font-heading` in globals.css resolve `var(--font-geist)`.
// Admin previously loaded Inter under `--font-inter`, which nothing referenced,
// so every heading fell back to system-ui while the webfont downloaded unused.
// Body text is unaffected: `--font-sans` uses "Inter Variable" from
// `@fontsource-variable/inter`, imported in globals.css.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
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
    // Admin is a staff-only surface; deny indexing across the board so
    // an accidental DNS misconfiguration can't expose it to search.
    robots: { index: false, follow: false },
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

  return (
    <html
      lang={locale}
      className={`${geist.variable} h-svh overflow-hidden antialiased`}
      suppressHydrationWarning
    >
      <body className="flex h-svh flex-col overflow-hidden">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
