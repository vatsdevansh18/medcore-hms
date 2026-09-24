import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys for the patient portal (brief "E2E Tests (Playwright)":
 * registration, book appointment, pay invoice, download report). Runs
 * against a running stack: the API on :3001 (with Postgres, Redis and
 * LocalStack) and the web app on :3000. Global setup creates a fresh patient
 * with clinical history through the real API, and teardown removes it.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
