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
