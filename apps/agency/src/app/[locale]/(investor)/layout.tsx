import { InvestorNav } from "@/components/investor/investor-nav";

export default function InvestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-canvas flex h-full flex-col overflow-y-auto">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <InvestorNav />
      <main id="main-content" data-front="investidor" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
