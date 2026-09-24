import { expect, test, type Browser, type Page } from "@playwright/test";
import { api, loadFixture, login, type PortalFixture } from "./fixture";

/**
 * Phase 13B follow-up (D-042): the last five screens, through the UI.
 * - A doctor sets weekly hours, a day off, and a prescription signature
 *   (FR-APPT-001, FR-RX-003). This uses a doctor created for the run, so
 *   no seeded doctor's hours change.
 * - A clinician records vaccinations and family history and attaches a
 *   file, which uploads straight to storage (FR-EMR-005/006).
 * - The Super Admin creates a hospital, gives it an admin, and verifies it
 *   (FR-HOSP-001).
 */
let fx: PortalFixture;
test.beforeAll(() => {
  fx = loadFixture();
});

// A 1×1 PNG and a minimal PDF, small real files for the upload paths.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(fx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|portal)$/);
  return page;
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test("a doctor sets weekly hours, a day off, and a signature", async ({ browser }) => {
  const doctor = await signedIn(browser, fx.ownDoctorEmail);
  await doctor.getByRole("navigation", { name: "Workspace" }).first().getByRole("link", { name: "My practice" }).click();
  await expect(doctor.getByRole("heading", { level: 1, name: "My practice" })).toBeVisible();
  const hours = doctor.getByRole("region", { name: "Weekly hours" });
  await expect(hours.getByText("No hours set")).toBeVisible();

  // Two Monday windows that overlap can't be saved.
  await hours.getByRole("button", { name: "Add hours" }).click();
  await hours.getByRole("button", { name: "Add hours" }).click();
  await expect(hours.getByText("Overlaps 09:00–13:00 on Monday.")).toBeVisible();
  await expect(hours.getByRole("button", { name: "Save weekly hours" })).toBeDisabled();
  await hours.getByRole("button", { name: /^Remove Monday/ }).last().click();
  await hours.getByLabel("To").fill("12:00");
  await hours.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(doctor.getByText("Weekly hours saved.", { exact: false })).toBeVisible();

  // The saved hours are what patients can book: the API now offers Monday slots.
  const token = await login(fx.ownDoctorEmail, fx.password);
  const week = await api<{ date: string; slots: unknown[] }[]>(
    `/doctors/${fx.ownDoctorId}/availability?dateFrom=${dateInDays(1)}&dateTo=${dateInDays(7)}`,
    { token },
  );
  const withSlots = week.filter((d) => d.slots.length > 0);
  expect(withSlots).toHaveLength(1);
  expect(withSlots[0].slots).toHaveLength(6);

  const changes = doctor.getByRole("region", { name: "Days off and changes" });
  const off = dateInDays(9);
  await changes.getByLabel("Date").fill(off);
  await changes.getByLabel("Reason (optional)").fill("Conference");
  await changes.getByRole("button", { name: "Save change" }).click();
  await expect(changes.getByText("Not available · Conference", { exact: false })).toBeVisible();
  await changes.getByRole("button", { name: "Remove" }).click();
  await doctor.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(changes.getByText("No upcoming changes", { exact: false })).toBeVisible();

  const signature = doctor.getByRole("region", { name: "Prescription signature" });
  await expect(signature.getByText("No signature yet", { exact: false })).toBeVisible();
  await doctor.locator("#signature-file").setInputFiles({ name: "signature.gif", mimeType: "image/gif", buffer: PNG });
  await expect(signature.getByRole("alert")).toHaveText(/isn't accepted/);
  await doctor.locator("#signature-file").setInputFiles({ name: "signature.png", mimeType: "image/png", buffer: PNG });
  await expect(signature.getByText("A signature is on file.")).toBeVisible();
  await doctor.context().close();
});

test("a clinician records vaccinations and family history, and attaches a file", async ({ browser }) => {
  const doctor = await signedIn(browser, fx.doctorEmail);
  await doctor.goto(`/dashboard/encounters/${fx.patientA.appointmentId}`);

  const vaccinations = doctor.getByRole("region", { name: "Vaccinations" });
  await vaccinations.getByRole("button", { name: "Add" }).click();
  await vaccinations.getByLabel("Vaccine").fill("Tetanus toxoid");
  await vaccinations.getByLabel("Given on").fill(dateInDays(-30));
  await vaccinations.getByLabel("Next dose (optional)").fill(dateInDays(-40));
  await vaccinations.getByRole("button", { name: "Save vaccination" }).click();
  await expect(vaccinations.getByText("The next dose must be after this one.")).toBeVisible();
  await vaccinations.getByLabel("Next dose (optional)").fill("");
  await vaccinations.getByRole("button", { name: "Save vaccination" }).click();
  await expect(vaccinations.getByText("Tetanus toxoid")).toBeVisible();

  const family = doctor.getByRole("region", { name: "Family history" });
  await family.getByRole("button", { name: "Add" }).click();
  await family.getByLabel("Condition").selectOption("HYPERTENSION");
  await family.getByLabel("Notes (optional)").fill("Father");
  await family.getByRole("button", { name: "Save" }).click();
  await expect(family.getByText("Hypertension")).toBeVisible();

  const files = doctor.getByRole("region", { name: "Attachments" });
  await doctor.locator(`#attach-${fx.recordA}`).setInputFiles({ name: "chest-xray.exe", mimeType: "application/pdf", buffer: PDF });
  await expect(files.getByRole("alert")).toHaveText(/isn't accepted/);
  await doctor.locator(`#attach-${fx.recordA}`).setInputFiles({ name: "chest-xray.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(files.getByText("chest-xray.pdf")).toBeVisible();
  // The file really reached storage: its short-lived link serves the bytes.
  // Listen on the context before clicking: the popup can request the URL
  // before a listener on the popup page itself would be attached.
  const signedRequest = doctor.context().waitForEvent("request", (r) => /X-Amz-Signature=/.test(r.url()));
  await files.getByRole("button", { name: "Open" }).click();
  const signed = await signedRequest;
  const body = await (await fetch(signed.url())).text();
  expect(body.startsWith("%PDF")).toBe(true);
  await doctor.context().close();

  // The patient sees their vaccination too (portal records read the same data).
  const patientToken = await login(fx.patientA.email, fx.password);
  const own = await api<{ vaccineName: string }[]>(`/patients/${fx.patientA.profileId}/vaccinations`, { token: patientToken });
  expect(own.map((v) => v.vaccineName)).toContain("Tetanus toxoid");
});

test("the Super Admin onboards a hospital: create, add its admin, verify", async ({ browser }) => {
  const admin = await signedIn(browser, "superadmin@medcore.test");
  await admin.getByRole("navigation", { name: "Workspace" }).first().getByRole("link", { name: "Hospitals" }).click();
  await admin.getByRole("button", { name: "New hospital" }).click();
  const form = admin.getByRole("region", { name: "New hospital" });
  await form.getByLabel("Name", { exact: true }).fill("E2E Onboarded Hospital");
  await form.getByLabel("Short name (slug)").fill("Not A Slug");
  await form.getByLabel("Contact email").fill(`contact-${fx.runId}@medcore.test`);
  await form.getByRole("button", { name: "Create hospital" }).click();
  await expect(form.getByText("Lowercase letters and digits, joined by hyphens.")).toBeVisible();
  await form.getByLabel("Short name (slug)").fill(fx.newHospitalSlug);
  await form.getByLabel("Street").fill("1 Test Road");
  await form.getByRole("button", { name: "Create hospital" }).click();
  await expect(form.getByText("Required with a street address.").first()).toBeVisible();
  await form.getByLabel("City").fill("Pune");
  await form.getByLabel("State").fill("Maharashtra");
  await form.getByLabel("Postal code").fill("411001");
  await form.getByRole("button", { name: "Create hospital" }).click();

  const row = admin.getByRole("row", { name: new RegExp(fx.newHospitalSlug) });
  await expect(row.getByText("Awaiting verification")).toBeVisible();

  await row.getByRole("button", { name: "Add admin" }).click();
  const adminForm = admin.getByRole("region", { name: "New admin for E2E Onboarded Hospital" });
  await adminForm.getByLabel("First name").fill("Hema");
  await adminForm.getByLabel("Last name").fill("Onboard");
  await adminForm.getByLabel("Work email").fill(fx.newHospitalAdminEmail);
  await adminForm.getByLabel("Employee code").fill("HA-001");
  await adminForm.getByRole("button", { name: "Add admin" }).click();
  await expect(adminForm).toHaveCount(0);

  // Not on the patient sign-up list until verified.
  const before = await api<{ slug: string }[]>("/hospitals/directory");
  expect(before.map((h) => h.slug)).not.toContain(fx.newHospitalSlug);
  await row.getByRole("button", { name: "Verify" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Verify hospital" }).click();
  await expect(row.getByText("Active", { exact: true })).toBeVisible();
  const after = await api<{ slug: string; city: string | null }[]>("/hospitals/directory");
  expect(after).toContainEqual(expect.objectContaining({ slug: fx.newHospitalSlug, city: "Pune" }));
  await admin.context().close();
});
