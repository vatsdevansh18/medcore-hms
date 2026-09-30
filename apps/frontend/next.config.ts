import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the production Docker image (infrastructure/docker/Dockerfile.frontend)
  // small — it bundles only the traced dependencies a request actually needs.
  output: "standalone",
};

// docs/03-ARCHITECTURE.md §14: Sentry error reporting is wired via
// src/instrumentation.ts and src/instrumentation-client.ts (explicit
// Sentry.init calls, gated by NEXT_PUBLIC_SENTRY_DSN_FRONTEND), not the
// `withSentryConfig` build-config wrapper — that wrapper's main job is
// source-map upload, which needs SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN,
// none of which exist anywhere in this project (matching every other
// external provider's UNVERIFIED status). Skipping it keeps the build
// config simple rather than fighting a feature we can't use yet.
export default nextConfig;
