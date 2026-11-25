import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local QA uses the loopback IP; Next otherwise blocks its dev connection.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Manage links carry a token: never leak them through Referer.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
