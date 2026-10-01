import type { Metadata, Viewport } from "next";
import { NotifyHost } from "@/components/ui/DeskNotice";
import { DESK_MD_BOOT_SCRIPT } from "@/lib/deskMdBoot";
import { DESK_THEME_STORAGE_KEY } from "@/lib/deskTheme";
import "./globals.css";

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
              `try{var t=localStorage.getItem(${JSON.stringify(DESK_THEME_STORAGE_KEY)});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}}catch(e){}`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: DESK_MD_BOOT_SCRIPT }} />
        {children}
        <NotifyHost />
      </body>
    </html>
  );
}
