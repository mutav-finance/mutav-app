import { LOGO_MARK_LETTER_PATHS, LOGO_MARK_PILL, LOGO_MARK_VIEW_BOX } from "./logo-mark-geometry";

export type LogoMarkProps = {
  /** Sizing and color come from the caller, e.g. `h-6 w-auto shrink-0 text-text`. */
  className?: string;
  /**
   * Names the mark when it stands alone. Leave it out when the mark sits next
   * to visible brand text — the mark is then decorative and hidden from
   * assistive technology.
   */
  ariaLabel?: string;
};

/**
 * The MUTAV M-mark; geometry in `./logo-mark-geometry`.
 *
 * The four letterform paths use `currentColor`, so the mark follows the
 * surrounding text color through the theme cascade. The accent pill uses
 * `var(--accent)`, so each app front picks up its own accent.
 *
 * Deliberately ships no Tailwind classes of its own: the package needs no
 * `@source` entry in the apps' `globals.css`.
 */
export function LogoMark({ className, ariaLabel }: LogoMarkProps) {
  return (
    <svg
      viewBox={LOGO_MARK_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
      className={className}
    >
      {LOGO_MARK_LETTER_PATHS.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      <rect {...LOGO_MARK_PILL} fill="var(--accent)" />
    </svg>
  );
}
