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
    default: "Sauti Desk",
    template: "%s · Sauti Desk",
  },
  description: "Missed-call leads and receptionist controls for East African businesses.",
  applicationName: "Sauti Desk",
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/brand/favicon.png" }],
    shortcut: ["/brand/favicon.png"],
  },
  openGraph: {
    title: "Sauti Desk",
    description: "Triage missed calls. Follow hot leads.",
    siteName: "Sauti Desk",
    images: [
      {
        url: "/brand/icon-white-bg.png",
        width: 1200,
        height: 630,
        alt: "Scalers",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Sauti Desk",
    description: "Triage missed calls. Follow hot leads.",
    images: ["/brand/icon-white-bg.png"],
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
