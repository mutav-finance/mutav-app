import { cn } from "@/lib/utils";

export function Mono({
  children,
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-mono
      className={cn("font-mono tabular-nums", className)}
      style={{ fontFeatureSettings: '"tnum" 1' }}
      {...props}
    >
      {children}
    </span>
  );
}
