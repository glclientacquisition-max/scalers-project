import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { DeskThemeProvider } from "@/components/DeskThemeProvider";
import { NotifyHost } from "@/components/ui/DeskNotice";
import { DESK_MD_BOOT_SCRIPT } from "@/lib/deskMdBoot";
import { DESK_THEME_STORAGE_KEY, parseDeskTheme } from "@/lib/deskTheme";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://scalers-project.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scalers, your 24-hour call assistant",
    template: "%s · Scalers",
  },
  description:
    "It answers when you are busy, after hours, on another call, or the line is off, so you do not miss the client.",
  applicationName: "Scalers",
  icons: {
    icon: [{ url: "/brand/favicon.png", type: "image/png" }],
    apple: [{ url: "/brand/favicon.png" }],
  },
  openGraph: {
    title: "Scalers, your 24-hour call assistant",
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
    title: "Scalers, your 24-hour call assistant",
    description:
      "It answers when you are busy, after hours, on another call, or the line is off, so you do not miss the client.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0096FF",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const saved = parseDeskTheme((await cookies()).get(DESK_THEME_STORAGE_KEY)?.value);
  return (
    <html lang="en" {...(saved === "system" ? {} : { "data-theme": saved })}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        {/* Desk theme before paint: localStorage, then cookie. Explicit choice wins. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var t=localStorage.getItem(${JSON.stringify(DESK_THEME_STORAGE_KEY)});if(t!=="dark"&&t!=="light"){var c=document.cookie.match(/(?:^|; )scalers-desk-theme=(light|dark)(?:;|$)/);t=c?c[1]:"";}if(t==="dark"||t==="light"){var r=document.documentElement;r.dataset.theme=t;var s=t==="dark"?"dark only":"light only";r.style.colorScheme=s;if(document.body)document.body.style.colorScheme=s;var m=document.querySelector('meta[name="color-scheme"]');if(!m){m=document.createElement("meta");m.name="color-scheme";document.head.appendChild(m);}m.content=t;document.cookie=${JSON.stringify(DESK_THEME_STORAGE_KEY)}+"="+t+"; Path=/; Max-Age=31536000; SameSite=Lax";}}catch(e){}`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: DESK_MD_BOOT_SCRIPT }} />
        <DeskThemeProvider initial={saved}>{children}</DeskThemeProvider>
        <NotifyHost />
      </body>
    </html>
  );
}
