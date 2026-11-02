import {
  LOGO_MARK_ACCENT,
  LOGO_MARK_ASPECT_RATIO,
  LOGO_MARK_INK,
  LOGO_MARK_LETTER_PATHS,
  LOGO_MARK_PILL,
  LOGO_MARK_VIEW_BOX,
} from "./logo-mark-geometry";

export type LogoMarkImageProps = {
  /** Rendered height in pixels; the width follows the mark's aspect ratio. */
  height: number;
  ink?: string;
  accent?: string;
};

/**
 * The M-mark with literal colors, for `next/og` `ImageResponse` renders (app
 * icons, link previews). Satori resolves neither CSS variables nor class
 * names, so the live `LogoMark` cannot be used there.
 */
export function LogoMarkImage({
  height,
  ink = LOGO_MARK_INK,
  accent = LOGO_MARK_ACCENT,
}: LogoMarkImageProps) {
  return (
    <svg
      viewBox={LOGO_MARK_VIEW_BOX}
      width={Math.round(height * LOGO_MARK_ASPECT_RATIO)}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
    >
      {LOGO_MARK_LETTER_PATHS.map((d) => (
        <path key={d} d={d} fill={ink} />
      ))}
      <rect {...LOGO_MARK_PILL} fill={accent} />
    </svg>
  );
}
