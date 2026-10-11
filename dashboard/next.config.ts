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
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
