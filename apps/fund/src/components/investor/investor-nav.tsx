"use client";

import { cn } from "@/lib/utils";
import { Link, usePathname } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/investor" },
  { label: "Deposit", href: "/investor/deposit" },
  { label: "Redeem", href: "/investor/redeem" },
  { label: "Transparency", href: "/investor/transparency" },
] as const satisfies { label: string; href: string }[];

export function InvestorNav() {
  const pathname = usePathname();

  return (
    <header className="border-border bg-surface relative flex h-16 shrink-0 items-stretch border-b">
      <Link
        href="/investor"
        className="flex shrink-0 items-center gap-2.5 px-6"
        aria-label="MUTAV Investor Portal"
      >
        <span className="bg-accent size-4" aria-hidden />
        <span className="text-text font-mono text-sm font-semibold tracking-widest">MUTAV</span>
      </Link>

      <nav
        className="pointer-events-none absolute inset-0 flex items-stretch justify-center"
        aria-label="Investor portal"
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
                {item.label}
                {isActive && <span className="bg-accent absolute inset-x-0 bottom-0 h-0.5" />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="ml-auto flex shrink-0 items-center px-6">
        <Button variant="outline" size="sm" disabled>
          Connect Wallet
        </Button>
      </div>
    </header>
  );
}
