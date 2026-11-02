import { LogoMark } from "@mutav/brand/logo-mark";
import { cn } from "./cn";

export type WordmarkSize = "sm" | "md";

const MARK_ICON_CLASS: Record<WordmarkSize, string> = {
  sm: "h-5",
  md: "h-6",
};

const MARK_TEXT_CLASS: Record<WordmarkSize, string> = {
  sm: "text-base",
  md: "text-lg",
};

export type WordmarkProps = {
  size?: WordmarkSize;
  className?: string;
};

/**
 * The brand text is hardcoded, not read from messages — brand names are not
 * localized. The visible text is the accessible name, so there is no
 * `aria-label` and the M-mark is decorative (`aria-hidden`);
 * where the lockup is a link, the app owns the wrapper and names it.
 */
export function Wordmark({ size = "sm", className }: WordmarkProps) {
  return (
    <span className={cn("text-text flex items-center gap-2", className)}>
      <LogoMark className={cn("w-auto shrink-0", MARK_ICON_CLASS[size])} />
      <span
        className={cn(
          "font-display text-accent leading-none font-bold tracking-[-0.03em] select-none",
          MARK_TEXT_CLASS[size],
        )}
      >
        mutav
      </span>
    </span>
  );
}
