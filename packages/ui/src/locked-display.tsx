import { cn } from "./cn";
import { Label } from "./label";

export function LockedDisplay({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-muted-foreground">{label}</Label>
      <div className="bg-muted/50 border-input text-muted-foreground rounded-md border px-3 py-2 font-mono text-sm">
        {value}
      </div>
    </div>
  );
}
