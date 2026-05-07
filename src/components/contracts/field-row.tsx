import { Mono } from "@/components/ui/mono";
import { cn } from "@/lib/utils";

export function FieldRow({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === "" || value == null;
  return (
    <div
      className={cn(
        "border-border grid grid-cols-1 gap-1 border-b px-6 py-3 last:border-b-0 sm:grid-cols-[minmax(180px,1fr)_2fr] sm:items-center sm:gap-4",
        className,
      )}
    >
      <dt className="text-muted-foreground sm:text-base-sm font-sans text-xs font-medium tracking-[0.01em]">
        {label}
      </dt>
      <dd className={cn("text-base-sm text-foreground", empty && "text-muted-foreground/60")}>
        {empty ? "—" : mono ? <Mono>{value}</Mono> : value}
      </dd>
    </div>
  );
}

export function FieldGroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border bg-secondary text-2xs text-muted-foreground border-b px-6 py-2 font-mono font-medium tracking-[0.06em] uppercase">
      {children}
    </div>
  );
}
