import type { NextConfig } from "next";

// CAPACITOR=1 produces a static export for the native shell. Vercel keeps
// the default server build, so the two deploy targets don't interfere.
const isCapacitor = process.env.CAPACITOR === "1";

const nextConfig: NextConfig = isCapacitor
  ? {
      output: "export",
      // Emit /login/index.html rather than /login.html so the webview's
      // file-based routing resolves paths the same way the router does.
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {};

export default nextConfig;
