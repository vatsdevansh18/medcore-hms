import { existsSync, unlinkSync } from "node:fs";
import { FIXTURE_FILE, loadFixture } from "./fixture";
import { runFixtureScript } from "./global-setup";

/** Removes the run's patients and everything made for them. Set
 * E2E_KEEP_FIXTURE=1 to keep them for inspecting a failure. */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(FIXTURE_FILE) || process.env.E2E_KEEP_FIXTURE === "1") return;
  runFixtureScript("teardown", loadFixture().runId);
  unlinkSync(FIXTURE_FILE);
}
