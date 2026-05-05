import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Providers } from "@/providers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  title: "SGR — Registered Guarantee System",
  description: "Manage rental guarantees across chains",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
