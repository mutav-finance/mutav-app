import { Lockup } from "@mutav/brand/lockup";
import { cn } from "./cn";

export type WordmarkSize = "sm" | "md";

const LOCKUP_HEIGHT_CLASS: Record<WordmarkSize, string> = {
  sm: "h-5",
  md: "h-6",
};

export type WordmarkProps = {
  size?: WordmarkSize;
  className?: string;
};

/**
 * The MUTAV lockup (M-mark + outlined "MUTAV") from `@mutav/brand`. Brand
 * names are not localized. The SVG names itself "MUTAV", so a link wrapping
 * the wordmark gets that name; where the app sets its own `aria-label` on the
 * wrapper, that label wins.
 */
export function Wordmark({ size = "sm", className }: WordmarkProps) {
  return (
    <span className={cn("text-text flex items-center", className)}>
      <Lockup className={cn("w-auto shrink-0 select-none", LOCKUP_HEIGHT_CLASS[size])} />
    </span>
  );
}
