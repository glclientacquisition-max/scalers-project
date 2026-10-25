import type { MetadataRoute } from "next";

/** Installable Desk. Icons come from scripts/gen-pwa-icons.mjs. apple-icon.png stays for iOS. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scalers",
    short_name: "Scalers",
    description: "Your calls, bookings and alerts.",
    start_url: "/home?source=pwa",
    scope: "/",
    display: "standalone",
    theme_color: "#0096FF",
    background_color: "#FFFFFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
