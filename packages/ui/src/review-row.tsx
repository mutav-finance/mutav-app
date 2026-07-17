import { cn } from "./cn";

export function ReviewRow({
  label,
  value,
  highlight,
  mono,
  missing,
  large,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
  missing?: string;
  large?: boolean;
  className?: string;
}) {
  const size = large ? "text-base" : "text-sm";
  return (
    <div className={cn("flex items-baseline gap-1.5 py-0.5", className)}>
      <span className={cn("text-muted-foreground shrink-0", size)}>{label}:</span>
      {missing ? (
        <span className="text-destructive text-sm font-medium">{missing}</span>
      ) : (
        <span className={cn(size, mono && "font-mono", highlight && "font-semibold")}>
          {value || "—"}
        </span>
      )}
    </div>
  );
}
