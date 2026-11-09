import {
  LOCKUP_LABEL,
  LOCKUP_VIEW_BOX,
  LOCKUP_WORD_PATH,
  LOCKUP_WORD_TRANSFORM,
} from "./lockup-geometry";
import { LOGO_MARK_LETTER_PATHS, LOGO_MARK_PILL } from "./logo-mark-geometry";

export type LockupProps = {
  /**
   * Sizing and color come from the caller, e.g. `h-6 w-auto shrink-0 text-text`.
   * Size by height; the view box keeps the proportions.
   */
  className?: string;
};

/**
 * The MUTAV lockup — M-mark plus the outlined word "MUTAV" — as one SVG;
 * geometry in `./lockup-geometry`.
 *
 * The mark's letterforms use `currentColor`, so they follow the surrounding
 * text color; the pill and the word use `var(--accent)`, so each app front
 * picks up its own accent. Same color contract as `LogoMark`.
 *
 * The SVG names itself ("MUTAV"), so a link wrapping it gets an accessible
 * name from it. Deliberately ships no Tailwind classes of its own: the package
 * needs no `@source` entry in the apps' `globals.css`.
 */
export function Lockup({ className }: LockupProps) {
  return (
    <svg
      viewBox={LOCKUP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={LOCKUP_LABEL}
      focusable="false"
      className={className}
    >
      {LOGO_MARK_LETTER_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      <rect {...LOGO_MARK_PILL} fill="var(--accent)" />
      <path transform={LOCKUP_WORD_TRANSFORM} d={LOCKUP_WORD_PATH} fill="var(--accent)" />
    </svg>
  );
}
