import type { Metadata, Viewport } from "next";
import { DM_Sans, Sora } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://scalers-project.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scalers | Autonomous business assistant for Kenya",
    template: "%s · Scalers",
  },
  description:
    "Autonomous business assistant for Kenyan SMEs. Answers when you're busy, after hours, or on-site, then sends leads to WhatsApp.",
  applicationName: "Scalers",
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/brand/favicon.png" }],
  },
  openGraph: {
    title: "Scalers | Autonomous business assistant for Kenya",
    description:
      "Answers when you're busy, after hours, or on-site. Captures the caller's name and reason, then sends the lead to WhatsApp.",
    siteName: "Scalers",
    images: [
      {
        url: "/og.png",
        width: 1254,
        height: 1254,
        alt: "Scalers",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Scalers | Autonomous business assistant for Kenya",
    description:
      "Answers when you're busy, after hours, or on-site. Captures the caller's name and reason, then sends the lead to WhatsApp.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0096FF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-surface-canvas font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
