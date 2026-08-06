import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Next rooted on the dashboard package (monorepo-safe).
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
