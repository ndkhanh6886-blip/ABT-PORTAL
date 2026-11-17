import type { NextConfig } from "next";

// Headers of static files (/_next/static, /public). Pages and /api get theirs, plus the nonce-based
// Content-Security-Policy, from src/proxy.ts: keep the values in step with it.
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
  {
    key: "X-Permitted-Cross-Domain-Policies",
    value: "none",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
    // request bodies the proxy buffers: file uploads (/api/upload, up to 250 MB). The app has no Server Actions.
    proxyClientMaxBodySize: "250mb",
  },
  // no next/image anywhere: switch the image optimizer endpoint (/_next/image) off instead of exposing it
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
