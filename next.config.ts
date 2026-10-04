import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Invoice photos and statement CSVs are uploaded through server actions.
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
