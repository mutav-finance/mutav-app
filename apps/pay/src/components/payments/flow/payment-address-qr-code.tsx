import QRCode from "qrcode";

type Props = {
  /** SEP-7 payment URI (`web+stellar:pay?…`). */
  data: string;
  /** Accessible title — read by SR before the desc. */
  title: string;
  /** Accessible long description — instructions for using the code. */
  desc: string;
  /** Side length in px. Defaults to 240 (mobile). */
  size?: number;
};

/**
 * Server-rendered SVG QR code for the SEP-7 payment URI. Monochrome,
 * 0px-radius, 1px-bordered to honor MUTAV Precision Brutalism. Carries
 * `<title>` and `<desc>` so screen readers announce both the payment
 * amount and an alternative path (paste the address).
 *
 * Rendered in an RSC — zero client JS.
 */
export async function PaymentAddressQrCode({ data, title, desc, size = 240 }: Props) {
  // node-qrcode returns a complete <svg>…</svg> string. We inject our own
  // title/desc by post-processing the open tag.
  const svgString = await QRCode.toString(data, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#1A1A1A", light: "#FFFFFF" },
    width: size,
  });

  // Insert role + aria + title + desc immediately after the opening <svg ...>
  const enriched = svgString.replace(
    /<svg([^>]*)>/,
    `<svg$1 role="img" aria-labelledby="qr-title qr-desc">
      <title id="qr-title">${escapeXml(title)}</title>
      <desc id="qr-desc">${escapeXml(desc)}</desc>`,
  );

  return (
    <div
      className="border-border inline-flex items-center justify-center border bg-white p-2"
      style={{ width: size + 16, height: size + 16 }}
      dangerouslySetInnerHTML={{ __html: enriched }}
    />
  );
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
