import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // If you are deploying to https://<username>.github.io/<repository-name>/,
  // uncomment the following line and replace <repository-name> with your actual repo name:
  basePath: '/soundchecker',
};

export default nextConfig;
