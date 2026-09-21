import type { NextConfig } from "next";

// Geliştirmede (npm run dev) /api istekleri API sunucusuna yönlendirilir.
// Üretimde host nginx /api/ yolunu doğrudan API'ye verir (bkz. nginx/kunye.conf), bu kural yedektir.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
