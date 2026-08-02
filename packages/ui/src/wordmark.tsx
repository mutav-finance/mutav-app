import { cn } from "./cn";

export type WordmarkVariant = "mark" | "display";
export type WordmarkSize = "sm" | "md";

const MARK_SQUARE_CLASS: Record<WordmarkSize, string> = {
  sm: "size-3.5",
  md: "size-4",
};

const MARK_TEXT_CLASS: Record<WordmarkSize, string> = {
  sm: "text-sm",
  md: "text-sm",
};

const DISPLAY_TEXT_CLASS: Record<WordmarkSize, string> = {
  sm: "text-sm",
  md: "text-base",
};

export type WordmarkProps = {
  variant?: WordmarkVariant;
  size?: WordmarkSize;
  className?: string;
};

/**
 * The brand text is hardcoded, not read from messages — brand names are not
 * localized. The visible text is the accessible name, so there is no
 * `aria-label`; where the lockup is a link, the app owns the wrapper and names it.
 */
export function Wordmark({ variant = "mark", size = "sm", className }: WordmarkProps) {
  if (variant === "display") {
    return (
      <span
        className={cn(
          "font-display text-accent font-bold tracking-tight",
          DISPLAY_TEXT_CLASS[size],
          className,
        )}
      >
        mutav
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("bg-accent", MARK_SQUARE_CLASS[size])} aria-hidden />
      <span
        className={cn("text-text font-mono font-semibold tracking-widest", MARK_TEXT_CLASS[size])}
      >
        MUTAV
      </span>
    </span>
  );
}
