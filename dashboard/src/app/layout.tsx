import type { Metadata, Viewport } from "next";
import { DeskThemeProvider } from "@/components/DeskThemeProvider";
import { NotifyHost } from "@/components/ui/DeskNotice";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { TooltipProvider } from "@/components/ui/Tooltip";
import {
  DESK_THEME_COLOR_LIGHT,
  DESK_THEME_INIT_SCRIPT,
} from "@/lib/deskTheme";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://scalers-project.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scalers, your 24-hour Business Assistant",
    template: "%s · Scalers",
  },
  description:
    "It answers when you are busy, after hours, on another call, or the line is off, so you do not miss the client.",
  applicationName: "Scalers",
  appleWebApp: { capable: true, title: "Scalers", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/icons/apple-180.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "Scalers, your 24-hour Business Assistant",
    description:
      "It answers when you are busy, after hours, on another call, or the line is off, so you do not miss the client.",
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
    title: "Scalers, your 24-hour Business Assistant",
    description:
      "It answers when you are busy, after hours, on another call, or the line is off, so you do not miss the client.",
    images: ["/og.png"],
  },
};

/**
 * Light by default. No cookie read here: the app prerenders (cacheComponents), and a
 * cookie read in the root layout would make every route blocking. The <head> script below picks
 * up a dark choice (localStorage, then the cookie) before first paint and re-points theme-color,
 * so the owner never sees the wrong theme flash.
 */
export const viewport: Viewport = {
  themeColor: DESK_THEME_COLOR_LIGHT,
  colorScheme: "light",
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
    <html
      lang="en"
      data-theme="light"
      style={{ colorScheme: "light only" }}
      suppressHydrationWarning
    >
      <head>
        {/* Before first paint: a saved dark pick (localStorage, then cookie) wins over the light default. */}
        <script dangerouslySetInnerHTML={{ __html: DESK_THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <DeskThemeProvider initial="light">
          <TooltipProvider>{children}</TooltipProvider>
        </DeskThemeProvider>
        <NotifyHost />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
