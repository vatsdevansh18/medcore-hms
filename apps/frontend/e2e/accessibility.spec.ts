import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loadFixture, type PortalFixture, resetRateLimits } from "./fixture";

// Each test starts with fresh rate-limit counters (see resetRateLimits).
test.beforeEach(async () => {
  await resetRateLimits();
});

/**
 * Phase 14 (NFR-A11Y-001..004): an axe scan of every screen, as the role
 * that uses it, in the light and the dark theme, against WCAG 2.1 A and AA.
 * Pages are scanned once their data has loaded (no skeletons left), since
 * a loading page hides most of what a user meets.
 */
let fx: PortalFixture;
test.beforeAll(() => {
  fx = loadFixture();
});

const CITY = "medcore-city.medcore.test";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type Violation = {
  page: string;
  scheme: string;
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|portal)$/);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // No skeleton or busy region left: the data-bearing view is showing.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[class*="shimmer"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

async function scan(page: Page, paths: string[]): Promise<Violation[]> {
  const found: Violation[] = [];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const path of paths) {
      await page.goto(path);
      await settle(page);
      const result = await new AxeBuilder({ page })
        .withTags(TAGS)
        // Next's dev-only overlay and route announcer are not part of the app.
        .exclude("nextjs-portal")
        .exclude("#__next-route-announcer__")
        .analyze();
      for (const v of result.violations) {
        found.push({
          page: path,
          scheme,
          id: v.id,
          impact: v.impact,
          help: v.help,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        });
      }
    }
  }
  return found;
}

function report(violations: Violation[]) {
  return violations
    .map((v) => `${v.scheme} ${v.page} [${v.impact}] ${v.id}: ${v.help} → ${v.targets.join(" | ")}`)
    .join("\n");
}

test.describe.configure({ timeout: 300_000 });

test("signed-out pages", async ({ page }) => {
  const v = await scan(page, [
    "/login",
    "/register",
    "/forgot-password",
    "/verify-email",
    "/reset-password",
  ]);
  expect(v, report(v)).toEqual([]);
});

test("patient portal", async ({ page }) => {
  await signIn(page, fx.patientA.email, fx.password);
  const v = await scan(page, [
    "/portal",
    "/portal/appointments",
    "/portal/appointments/book",
    `/portal/appointments/${fx.patientA.appointmentId}`,
    "/portal/records",
    `/portal/records/${fx.recordA}`,
    "/portal/prescriptions",
    `/portal/prescriptions/${fx.prescriptionA}`,
    "/portal/lab-reports",
    `/portal/lab-reports/${fx.labOrderA}`,
    "/portal/invoices",
    `/portal/invoices/${fx.invoiceA}`,
  ]);
  expect(v, report(v)).toEqual([]);
});

test("doctor workspace", async ({ page }) => {
  await signIn(page, fx.doctorEmail, fx.password);
  const v = await scan(page, [
    "/dashboard",
    "/dashboard/appointments",
    `/dashboard/appointments/${fx.patientA.appointmentId}`,
    `/dashboard/encounters/${fx.patientA.appointmentId}`,
    `/dashboard/lab-orders/${fx.labOrderA}`,
    `/dashboard/prescriptions/${fx.prescriptionA}`,
    "/dashboard/patients",
    `/dashboard/patients/${fx.patientA.profileId}`,
    "/dashboard/practice",
    "/dashboard/search?q=asha",
  ]);
  expect(v, report(v)).toEqual([]);
});

test("front desk and billing", async ({ page }) => {
  await signIn(page, fx.receptionistEmail, fx.password);
  const v = await scan(page, [
    "/dashboard",
    "/dashboard/patients/new",
    `/dashboard/appointments/new?patientId=${fx.patientA.profileId}`,
    `/dashboard/invoices/${fx.invoiceA}`,
    "/dashboard/invoices",
  ]);
  expect(v, report(v)).toEqual([]);
});

test("lab, pharmacy, nurse, accountant", async ({ page }) => {
  const all: Violation[] = [];
  for (const [email, paths] of [
    [
      fx.labTechEmail,
      ["/dashboard", "/dashboard/lab-orders", `/dashboard/lab-orders/${fx.labOrderA}`],
    ],
    [
      `pharmacist@${CITY}`,
      [
        "/dashboard",
        `/dashboard/prescriptions/${fx.prescriptionA}`,
        "/dashboard/medicines",
        `/dashboard/medicines/${fx.medicineId}`,
        "/dashboard/inventory",
      ],
    ],
    [`nurse@${CITY}`, ["/dashboard", "/dashboard/beds"]],
    [`accountant@${CITY}`, ["/dashboard", "/dashboard/payments"]],
  ] as [string, string[]][]) {
    await page.context().clearCookies();
    await signIn(page, email, fx.password);
    all.push(...(await scan(page, paths)));
  }
  expect(all, report(all)).toEqual([]);
});

test("hospital and platform administration", async ({ page }) => {
  const all: Violation[] = [];
  for (const [email, paths] of [
    [
      `hospitaladmin@${CITY}`,
      [
        "/dashboard",
        "/dashboard/staff",
        "/dashboard/departments",
        "/dashboard/settings",
        "/dashboard/audit",
      ],
    ],
    ["superadmin@medcore.test", ["/dashboard", "/dashboard/hospitals"]],
  ] as [string, string[]][]) {
    await page.context().clearCookies();
    await signIn(page, email, fx.password);
    all.push(...(await scan(page, paths)));
  }
  expect(all, report(all)).toEqual([]);
});

test.describe("keyboard and layout (NFR-A11Y-001)", () => {
  test("signs in with the keyboard alone, and the skip link jumps past the navigation", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(fx.receptionistEmail);
    await page.keyboard.press("Tab");
    await page.keyboard.type(fx.password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/dashboard$/);

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("a dialog traps focus, closes on Escape, and returns focus to its trigger", async ({
    page,
  }) => {
    await signIn(page, fx.receptionistEmail, fx.password);
    await page.goto(`/dashboard/invoices/${fx.invoiceA}`);
    const trigger = page.getByRole("button", { name: "Record cash" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("tablets get an icon rail whose links keep their names; desktops the full sidebar", async ({
    page,
  }) => {
    await signIn(page, fx.doctorEmail, fx.password);
    const nav = page.getByRole("navigation", { name: "Workspace" }).first();
    await page.setViewportSize({ width: 820, height: 1000 });
    await expect(nav.getByRole("link", { name: "My schedule" })).toBeVisible();
    const railWidth = await nav.evaluate((n) => n.closest("aside")!.getBoundingClientRect().width);
    expect(railWidth).toBeLessThanOrEqual(64);
    await expect(nav.getByText("My schedule")).toHaveClass(/sr-only/);
    await page.setViewportSize({ width: 1280, height: 900 });
    const fullWidth = await nav.evaluate((n) => n.closest("aside")!.getBoundingClientRect().width);
    expect(fullWidth).toBeGreaterThan(200);
    await expect(nav.getByText("My schedule")).toBeVisible();
  });
});
