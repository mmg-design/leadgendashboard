import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep local dev and production artifacts away from Ship Studio's managed
  // .next cache. The npm scripts assign each process a separate output dir.
  // Vercel always expects the default ".next" output dir (it sets VERCEL=1 during
  // build), so ignore the override there even though it runs the same npm script.
  distDir: process.env.VERCEL ? ".next" : (process.env.NEXT_DIST_DIR || ".next"),
};

export default nextConfig;
