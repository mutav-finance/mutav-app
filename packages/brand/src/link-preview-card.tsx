import { LogoMarkImage } from "./logo-mark-image";

/** Open Graph's recommended card size. */
export const LINK_PREVIEW_SIZE = { width: 1200, height: 630 } as const;

// Light canvas tokens, mirrored from `mutav/web` (its agency front).
const CANVAS = "#F7F6F3";
const TEXT_2 = "#6B6860";
const ACCENT_TEXT = "#C47E10";

export type LinkPreviewCardProps = {
  /** Pre-translated descriptor line under the lockup. */
  descriptor: string;
};

/**
 * The link-preview card behind each app's `opengraph-image.tsx`: the lockup
 * (M-mark + "mutav") and the descriptor on the light canvas. It carries no
 * per-page data, so a shared link never previews what it points at.
 */
export function LinkPreviewCard({ descriptor }: LinkPreviewCardProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 40,
        background: CANVAS,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <LogoMarkImage height={120} />
        <span
          style={{
            fontSize: 128,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: ACCENT_TEXT,
          }}
        >
          mutav
        </span>
      </div>
      <span style={{ fontSize: 40, color: TEXT_2, letterSpacing: "0.01em" }}>{descriptor}</span>
    </div>
  );
}
