import { LockIcon } from "lucide-react";
import { cn } from "./cn";
import { Label } from "./label";

export function LockedField({
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
      <div className="flex items-center gap-1.5">
        <Label className="text-muted-foreground">{label}</Label>
        <LockIcon className="text-muted-foreground/60 h-3 w-3" />
      </div>
      <div className="bg-muted/50 border-input text-muted-foreground rounded-md border px-3 py-2 font-mono text-sm">
        {value}
      </div>
    </div>
  );
}
