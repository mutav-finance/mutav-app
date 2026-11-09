import {
  LOCKUP_ASPECT_RATIO,
  LOCKUP_COLORS,
  LOCKUP_VIEW_BOX,
  LOCKUP_WORD_PATH,
  LOCKUP_WORD_TRANSFORM,
  type LockupVariant,
} from "./lockup-geometry";
import { LOGO_MARK_LETTER_PATHS, LOGO_MARK_PILL } from "./logo-mark-geometry";

export type LockupImageProps = {
  /** Rendered height in pixels; the width follows the lockup's aspect ratio. */
  height: number;
  /** `light` for paper canvases (the default), `dark` for dark ones. */
  variant?: LockupVariant;
};

/**
 * The lockup with literal colors, for `next/og` `ImageResponse` renders (link
 * previews). Satori resolves neither CSS variables nor class names, so the
 * live `Lockup` cannot be used there. The word is outlined paths, so no font
 * has to be loaded.
 */
export function LockupImage({ height, variant = "light" }: LockupImageProps) {
  const { ink, accent } = LOCKUP_COLORS[variant];
  return (
    <svg
      viewBox={LOCKUP_VIEW_BOX}
      width={Math.round(height * LOCKUP_ASPECT_RATIO)}
      height={height}
      xmlns="http://www.w3.org/2000/svg"
    >
      {LOGO_MARK_LETTER_PATHS.map((d) => (
        <path key={d} d={d} fill={ink} />
      ))}
      <rect {...LOGO_MARK_PILL} fill={accent} />
      <path transform={LOCKUP_WORD_TRANSFORM} d={LOCKUP_WORD_PATH} fill={accent} />
    </svg>
  );
}
