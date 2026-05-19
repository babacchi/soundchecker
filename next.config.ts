import type { NextConfig } from "next";
const isProd = process.env.NODE_ENV === "production";
const repositoryName = "soundchecker";
const nextConfig: NextConfig = {
  /* config options here */
  output: "export",
  ...(isProd
    ? {
        basePath: `/${repositoryName}`,
        assetPrefix: `/${repositoryName}/`,
      }
    : {}),
};

export default nextConfig;
