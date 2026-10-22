import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Client router cache: a tab you visited in the last 30s opens instantly from memory.
    // Server actions (revalidatePath / router.refresh) and LiveInbox refreshes still purge it.
    staleTimes: { dynamic: 30, static: 180 },
  },
  // Keep Next rooted on the dashboard package (monorepo-safe).
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingIncludes: {
    // Voice modules the assistant-say bridge require()s at runtime (lib/voiceRequire.server.ts).
    // scripts/sync-voice-modules.cjs copies them here before `next build`.
    "/**": ["./.voice/**/*"],
  },
  // Old links and muscle memory: the Inbox lives at /calls.
  async headers() {
    return [
      {
        // The filled pay page was a public prerender (Vercel HIT). The API is no-store.
        source: "/pay/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
          {
            key: "Vercel-CDN-Cache-Control",
            value: "no-store",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/inbox", destination: "/calls", permanent: false },
      { source: "/inbox/:path*", destination: "/calls/:path*", permanent: false },
      // Owners type /setup: setup lives in Settings once the line is open (onboarding sends finished workspaces to /home).
      { source: "/setup", destination: "/settings", permanent: false },
      // Owners and docs say "Usage"; the page lives at /wallet.
      { source: "/usage", destination: "/wallet", permanent: false },
    ];
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
