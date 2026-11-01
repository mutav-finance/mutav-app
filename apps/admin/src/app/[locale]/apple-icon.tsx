import { ImageResponse } from "next/og";
import { LogoMarkImage } from "@mutav/brand/logo-mark-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const CANVAS = "#F7F6F3";
const MARK_HEIGHT = 92;

// Lives under `[locale]`, not the app-dir root: `/apple-icon` has no file
// extension, so the proxy matcher hands it to next-intl, which rewrites it to
// `/<locale>/apple-icon`.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CANVAS,
        }}
      >
        <LogoMarkImage height={MARK_HEIGHT} />
      </div>
    ),
    { ...size },
  );
}
