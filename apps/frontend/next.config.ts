import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the production Docker image (infrastructure/docker/Dockerfile.frontend)
  // small — it bundles only the traced dependencies a request actually needs.
  output: "standalone",
};

export default nextConfig;
