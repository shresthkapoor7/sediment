import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "sediment-seven\\.vercel\\.app",
          },
        ],
        destination: "https://sediment-ai.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
