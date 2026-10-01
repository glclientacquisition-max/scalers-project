import type { Metadata, Viewport } from "next";
import { NotifyHost } from "@/components/ui/DeskNotice";
import { DESK_THEME_STORAGE_KEY } from "@/lib/deskTheme";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://scalers.co.ke";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scalers | Business assistant for your phone line",
    template: "%s · Scalers",
  },
  description:
    "Scalers answers missed, busy, and after-hours calls on your business number. Train the facts and work the inbox in Desk. Private beta.",
  applicationName: "Scalers",
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/brand/favicon.png" }],
  },
  openGraph: {
    title: "Scalers | Business assistant for your phone line",
    description:
      "Answers missed, busy, and after-hours calls on your business number. Train the facts and work the inbox in Desk. Private beta.",
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
    title: "Scalers | Business assistant for your phone line",
    description:
      "Answers missed, busy, and after-hours calls on your business number. Train the facts and work the inbox in Desk. Private beta.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0096FF",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        {/* Desk theme before paint: explicit choice wins, otherwise system decides. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem(${JSON.stringify(DESK_THEME_STORAGE_KEY)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}`,
          }}
        />
        {children}
        <NotifyHost />
      </body>
    </html>
  );
}
