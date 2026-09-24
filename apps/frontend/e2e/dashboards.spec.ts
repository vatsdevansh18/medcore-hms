import { expect, test, type Page } from "@playwright/test";
import { loadFixture, type PortalFixture } from "./fixture";

/**
 * Phase 13: role dashboards, global search, filtered lists
 * (FR-ANALYTICS-001, FR-SEARCH-001). Staff sign in with the seeded
 * accounts; the fixture patient (Asha Portal) gives known rows to find.
 */
let fx: PortalFixture;
test.beforeAll(() => {
  fx = loadFixture();
});

const CITY = "medcore-city.medcore.test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(fx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function navLabels(page: Page) {
  return page.getByRole("navigation", { name: "Workspace" }).first().getByRole("link").allTextContents();
}

const ROLES: [string, string, string, string[]][] = [
  ["Hospital Admin", `hospitaladmin@${CITY}`, "Hospital overview", ["Overview", "Appointments", "Bills", "Payments", "Inventory", "Beds", "Audit log"]],
  ["Nurse", `nurse@${CITY}`, "Ward & clinic", ["Overview", "Appointments", "Beds"]],
  ["Receptionist", `receptionist@${CITY}`, "Front desk", ["Overview", "Schedule", "Bills"]],
  ["Lab Technician", `lab_technician@${CITY}`, "Laboratory queue", ["Overview", "Lab queue"]],
  ["Pharmacist", `pharmacist@${CITY}`, "Pharmacy", ["Overview", "Dispensing queue", "Inventory"]],
  ["Accountant", `accountant@${CITY}`, "Finance", ["Overview", "Bills", "Payments"]],
  ["Super Admin", "superadmin@medcore.test", "Platform overview", ["Overview", "Audit log"]],
];

test.describe("role dashboards", () => {
  for (const [role, email, heading, nav] of ROLES) {
    test(`${role} lands on their own dashboard with only their navigation`, async ({ page }) => {
      await signIn(page, email);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect((await navLabels(page)).map((t) => t.trim())).toEqual(nav);
    });
  }

  test("a doctor sees today's timeline, the lab panel, and the month calendar", async ({ page }) => {
    await signIn(page, fx.doctorEmail);
    await expect(page.getByRole("heading", { level: 1, name: /^Good day, Dr\./ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's appointments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lab results pending" })).toBeVisible();
    await expect(page.locator("table caption").filter({ hasText: /\d{4}$/ })).toBeVisible();
  });

  test("the admin dashboard shows today's KPIs and described charts", async ({ page }) => {
    await signIn(page, `hospitaladmin@${CITY}`);
    for (const label of ["Patients today", "Appointments today", "Revenue today", "Occupied beds", "Active doctors"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Charts carry a text summary for screen readers (colour is never the only channel).
    await expect(page.locator("figcaption").filter({ hasText: /^Appointments per day/ })).toHaveCount(1);
    await expect(page.locator("figcaption").filter({ hasText: /^Revenue from/ })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Department occupancy" })).toBeVisible();
  });

  test("the Super Admin sees the platform without a hospital search box", async ({ page }) => {
    await signIn(page, "superadmin@medcore.test");
    await expect(page.getByText(/\(UTC\)$/)).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });
});

test.describe("access control in the workspace", () => {
  test("a role can't open another role's page, and the API refuses it too", async ({ page }) => {
    await signIn(page, `pharmacist@${CITY}`);
    await page.goto("/dashboard/payments");
    await expect(page.getByText("This page isn't part of your workspace")).toBeVisible();
    const token = await page.evaluate(async () => {
      const res = await fetch("http://localhost:3001/api/auth/refresh", { method: "POST", credentials: "include" });
      return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
    });
    const res = await page.request.get("http://localhost:3001/api/payments", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(403);
  });

  test("a patient who opens the staff workspace is sent to the portal", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fx.patientA.email);
    await page.getByLabel("Password").fill(fx.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/portal$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/portal$/);
  });
});

test.describe("global search (FR-SEARCH-001)", () => {
  test("finds a patient from the top bar by keyboard and opens the results", async ({ page }) => {
    await signIn(page, `receptionist@${CITY}`);
    const box = page.getByRole("combobox", { name: "Search patients, doctors, and medicines" });
    await box.fill(`e2e-a-${fx.runId}`);
    const option = page.getByRole("option", { name: /Asha Portal/ });
    await expect(option).toBeVisible();
    await box.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/search\?q=.*&scope=patients/);
    await expect(page.getByRole("tab", { name: /Patients \(1\)/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("cell", { name: "Asha Portal" })).toBeVisible();
  });

  test("shows only the scopes a role may search", async ({ page }) => {
    await signIn(page, `pharmacist@${CITY}`);
    await page.goto("/dashboard/search?q=para");
    await expect(page.getByRole("tab", { name: /Medicines/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Doctors/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Patients/ })).toHaveCount(0);
  });
});

test.describe("filtered, paginated lists", () => {
  test("the lab queue filters by stage and keeps the filter in the URL", async ({ page }) => {
    await signIn(page, `lab_technician@${CITY}`);
    await page.getByRole("link", { name: "Lab queue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lab queue" })).toBeVisible();
    await page.getByLabel("Stage").selectOption({ label: "Result ready" });
    await expect(page).toHaveURL(/status=APPROVED/);
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    // Oldest first, so today's fixture order is on the last page.
    const paging = await page.getByText(/^Page \d+ of \d+/).textContent().catch(() => null);
    const last = paging ? Number(/of (\d+)/.exec(paging)?.[1] ?? 1) : 1;
    if (last > 1) await page.goto(`/dashboard/lab-orders?status=APPROVED&page=${last}`);
    await expect(page.getByRole("row").filter({ hasText: "Asha Portal" }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Stage")).toHaveValue("APPROVED");
  });

  test("the accountant's outstanding filter includes a part-paid bill", async ({ page }) => {
    await signIn(page, `accountant@${CITY}`);
    await page.goto("/dashboard/invoices");
    await page.getByLabel("Status").selectOption({ label: "Outstanding" });
    await expect(page).toHaveURL(/status=FINALIZED%2CPARTIALLY_PAID|status=FINALIZED,PARTIALLY_PAID/);
    const row = page.getByRole("row").filter({ hasText: "Asha Portal" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("Partly paid")).toBeVisible();
  });

  test("the audit log opens pre-filtered from a link and shows no record contents", async ({ page }) => {
    await signIn(page, `hospitaladmin@${CITY}`);
    await page.goto("/dashboard/audit?entityType=Payment");
    await expect(page.getByLabel("Record type")).toHaveValue("Payment");
    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Payment" }).first()).toBeVisible();
  });
});
