import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production artifacts away from Ship Studio's managed dev cache.
  // Running `next build` while the preview is open must not corrupt `.next/dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
