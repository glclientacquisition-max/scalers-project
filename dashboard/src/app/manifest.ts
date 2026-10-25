import type { MetadataRoute } from "next";
import { DESK_THEME_COLOR_LIGHT } from "@/lib/deskTheme";

/**
 * Installable Desk. Icons come from scripts/gen-pwa-icons.mjs (transparent mark; maskable on the
 * light canvas). Android builds the launch splash from background_color + the 512 icon, so both
 * colours are the light canvas: no blue or dark flash before the first page paints.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scalers",
    short_name: "Scalers",
    description: "Your calls, bookings and alerts.",
    start_url: "/home?source=pwa",
    scope: "/",
    display: "standalone",
    theme_color: DESK_THEME_COLOR_LIGHT,
    background_color: DESK_THEME_COLOR_LIGHT,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
