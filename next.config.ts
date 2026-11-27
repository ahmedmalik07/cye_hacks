import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local QA uses the loopback IP; Next otherwise blocks its dev connection.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: __dirname },
  // Don't advertise the framework, and never ship source maps to browsers.
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Manage links carry a token: never leak them through Referer.
          { key: "Referrer-Policy", value: "same-origin" },
          // HTTPS only for a year. Browsers ignore this on plain-HTTP responses (local dev, CI).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
