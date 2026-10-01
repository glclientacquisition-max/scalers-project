import type { Metadata, Viewport } from "next";
import { NotifyHost } from "@/components/ui/DeskNotice";
import { DESK_THEME_STORAGE_KEY } from "@/lib/deskTheme";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://scalers.co.ke";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scalers | Business assistant",
    template: "%s · Scalers",
  },
  description:
    "A business assistant that helps you run the business. It answers from your business knowledge, notifies you by SMS, WhatsApp, and email, and keeps the work in the Scalers app. Private beta.",
  applicationName: "Scalers",
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/brand/favicon.png" }],
  },
  openGraph: {
    title: "Scalers | Business assistant",
    description:
      "A business assistant that helps you run the business. It answers from your business knowledge, notifies you by SMS, WhatsApp, and email, and keeps the work in the Scalers app. Private beta.",
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
    title: "Scalers | Business assistant",
    description:
      "A business assistant that helps you run the business. It answers from your business knowledge, notifies you by SMS, WhatsApp, and email, and keeps the work in the Scalers app. Private beta.",
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
