import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Keep Next rooted on the dashboard package (monorepo-safe).
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  // Phone-system clips (Voice <Play>): public, no auth, versioned file names,
  // so they are cached for a year and never revalidated. A new recording gets
  // a new name (downtime-en.v2.wav), never an overwrite.
  async headers() {
    return [
      {
        source: "/audio/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
