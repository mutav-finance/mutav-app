/**
 * `PageHeader` always renders an `<h1>`; the secondary panels on the defaults
 * page sit under that page's title, so they take the same look one level down.
 */
export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="flex flex-col gap-1 px-4 lg:px-6">
      <h2 className="font-display text-foreground text-xl font-bold tracking-tight">{title}</h2>
      <p className="text-base-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}
