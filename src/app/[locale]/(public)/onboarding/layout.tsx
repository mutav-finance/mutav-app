import { Link } from "@/i18n/navigation";
import { PublicFooter } from "@/components/public/public-footer";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-border bg-canvas border-b">
        <div className="flex h-14 items-center px-4 lg:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="MUTAV">
            <span className="bg-accent size-3.5" aria-hidden />
            <span className="font-mono text-sm font-semibold tracking-widest">MUTAV</span>
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <PublicFooter />
    </>
  );
}
