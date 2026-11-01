/**
 * Geometry of the MUTAV M-mark, copied from the marketing site
 * (`mutav/web/components/primitives/logo-mark.tsx`). One source for the live
 * `LogoMark` and the `next/og` renders, which cannot resolve CSS variables.
 */
export const LOGO_MARK_VIEW_BOX = "0 0 72 60";

/** Width over height of the view box. */
export const LOGO_MARK_ASPECT_RATIO = 72 / 60;

export const LOGO_MARK_LETTER_PATHS = [
  "M25.2002 3.59711C20.8004 7.26576 18.0001 12.7878 18 18.9643V59.0434C17.1113 59.3022 16.1724 59.4438 15.2002 59.4438H0V20.0444C0 8.99868 8.95431 0.0443737 20 0.0443726H25.2002V3.59711Z",
  "M19.8 28.8H45V49.4C45 54.9228 40.5228 59.4 35 59.4H19.8V28.8Z",
  "M45 0H39.8C28.7543 0 19.8 8.95431 19.8 20V35.8C19.8 36.9046 20.6954 37.8 21.8 37.8H45V0Z",
  "M72 0H66.8C55.7543 0 46.8 8.95431 46.8 20V31.8C46.8 35.1137 49.4863 37.8 52.8 37.8H72V0Z",
] as const;

export const LOGO_MARK_PILL = { x: 46.8, y: 43.2, width: 25.2, height: 16.2, rx: 8.1 } as const;

/** Light-canvas colors of `mutav/web/app/icon.svg`. */
export const LOGO_MARK_INK = "#1A1A1A";
export const LOGO_MARK_ACCENT = "#E8A020";
