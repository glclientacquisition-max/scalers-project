import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // Client router cache: a tab you visited in the last 30s opens instantly from memory.
    // Server actions (revalidatePath / router.refresh) and LiveInbox refreshes still purge it.
    staleTimes: { dynamic: 30, static: 180 },
    // Smart import uploads PDFs up to 10 MB (photos are shrunk in the browser first).
    // Next only offers a global limit; every action still checks its own input.
    // Flag off: the Next default (1 MB), so nothing changes until DESK_SMART_IMPORT is on.
    serverActions: {
      bodySizeLimit: /^(1|true|on|yes)$/i.test(String(process.env.DESK_SMART_IMPORT || "").trim()) ? "12mb" : "1mb",
    },
  },
  // Keep Next rooted on the dashboard package (monorepo-safe).
  outputFileTracingRoot: path.join(__dirname),
  // Old links and muscle memory: the Inbox lives at /calls.
  async redirects() {
    return [
      { source: "/inbox", destination: "/calls", permanent: false },
      { source: "/inbox/:path*", destination: "/calls/:path*", permanent: false },
    ];
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
