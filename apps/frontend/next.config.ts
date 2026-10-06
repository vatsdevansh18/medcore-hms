import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the production Docker image (infrastructure/docker/Dockerfile.frontend)
  // small — it bundles only the traced dependencies a request actually needs.
  output: "standalone",
  // Split-domain deployments (e.g. Vercel frontend + a separately-hosted
  // API) only need this when BACKEND_ORIGIN is set — see docs/11-DECISIONS.md
  // D-045 for why: the refresh-token cookie is sameSite:"strict"
  // (SEC-AUTHN-004), which browsers never send on a cross-site fetch. This
  // rewrite makes the browser see every /api/* call as same-origin (Vercel
  // proxies it server-side to the real API), so the cookie keeps working
  // without loosening its SameSite policy. Unset (local dev, Docker) means
  // no rewrite at all — the frontend calls the API directly, as before.
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN;
    if (!backendOrigin) return [];
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  },
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
