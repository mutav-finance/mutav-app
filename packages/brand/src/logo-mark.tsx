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
 * The MUTAV M-mark, copied from the marketing site
 * (`mutav/web/components/primitives/logo-mark.tsx`).
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
      viewBox="0 0 72 60"
      xmlns="http://www.w3.org/2000/svg"
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
      className={className}
    >
      <path
        d="M25.2002 3.59711C20.8004 7.26576 18.0001 12.7878 18 18.9643V59.0434C17.1113 59.3022 16.1724 59.4438 15.2002 59.4438H0V20.0444C0 8.99868 8.95431 0.0443737 20 0.0443726H25.2002V3.59711Z"
        fill="currentColor"
      />
      <path d="M19.8 28.8H45V49.4C45 54.9228 40.5228 59.4 35 59.4H19.8V28.8Z" fill="currentColor" />
      <path
        d="M45 0H39.8C28.7543 0 19.8 8.95431 19.8 20V35.8C19.8 36.9046 20.6954 37.8 21.8 37.8H45V0Z"
        fill="currentColor"
      />
      <rect x="46.8" y="43.2" width="25.2" height="16.2" rx="8.1" fill="var(--accent)" />
      <path
        d="M72 0H66.8C55.7543 0 46.8 8.95431 46.8 20V31.8C46.8 35.1137 49.4863 37.8 52.8 37.8H72V0Z"
        fill="currentColor"
      />
    </svg>
  );
}
