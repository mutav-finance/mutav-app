"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@mutav/ui/cn";
import { Link, usePathname } from "@mutav/i18n/navigation";
import { Wordmark } from "@mutav/ui/wordmark";

const NAV_ITEMS = [
  { key: "dashboard", href: "/investor" },
  { key: "deposit", href: "/investor/deposit" },
  { key: "redeem", href: "/investor/redeem" },
  { key: "transparency", href: "/investor/transparency" },
] as const satisfies { key: string; href: string }[];

export function InvestorNav({ identity }: { identity: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tMain = useTranslations("nav.main");

  return (
    <header className="border-border bg-surface relative flex h-16 shrink-0 items-stretch border-b">
      <Link
        href="/investor"
        className="flex shrink-0 items-center px-6"
        aria-label={t("brandLabel")}
      >
        <Wordmark size="md" />
      </Link>

      {/* Absolutely positioned so the nav centers against the header, not
          against the flex row: `pointer-events-none` on the overlay with
          `pointer-events-auto` on the links keeps the rest of the row clickable. */}
      <nav
        className="pointer-events-none absolute inset-0 flex items-stretch justify-center"
        aria-label={t("ariaLabel")}
      >
        <div className="pointer-events-auto flex items-stretch gap-0">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/investor" ? pathname === "/investor" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center px-4 text-sm transition-colors",
                  isActive ? "text-text font-medium" : "text-text-2 hover:text-text",
                )}
              >
                {tMain(item.key)}
                {isActive && <span className="bg-accent absolute inset-x-0 bottom-0 h-0.5" />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="ml-auto flex shrink-0 items-center px-6">{identity}</div>
    </header>
  );
}
