import { expect, test, type Browser, type Page } from "@playwright/test";
import { api, loadFixture, login, type PortalFixture } from "./fixture";
import { runFixtureScript } from "./global-setup";

/**
 * Phase 13B gate (docs/05-DEVELOPMENT-PLAN.md): the full patient journey
 * through the staff screens, every step in the UI.
 *
 * registration → booking → encounter (vitals) → prescription → lab order →
 * lab result + four-eyes approval → dispensing → invoice → cash payment →
 * the patient sees it all in the portal.
 *
 * Each role works in its own browser context, as on separate machines. The
 * API is only used to read which medicine and test to pick, and the fixture
 * script only stands in for the patient's emailed set-password link.
 */
let fx: PortalFixture;
test.beforeAll(() => {
  fx = loadFixture();
});

const CITY = "medcore-city.medcore.test";
const ALERT = '[role="alert"]:not(#__next-route-announcer__)';

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(fx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|portal)$/);
  return page;
}

async function confirmIn(page: Page, button: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: button }).click();
  await expect(dialog).toBeHidden();
}

test("a patient's whole visit, from the front desk to the portal, through the UI", async ({ browser }) => {
  test.setTimeout(240_000);
  const journeyEmail = `e2e-journey-${fx.runId}@patient.medcore.test`;

  // What the doctor will pick: a stocked medicine and a catalog test.
  const pharmacistToken = await login(`pharmacist@${CITY}`, fx.password);
  const medicines = await api<{ id: string; name: string; availableQuantity: number }[]>("/medicines?limit=100", { token: pharmacistToken });
  const medicine = medicines.sort((a, b) => b.availableQuantity - a.availableQuantity)[0];
  expect(medicine.availableQuantity).toBeGreaterThanOrEqual(2);
  const doctorToken = await login(fx.doctorEmail, fx.password);
  const [labTest] = await api<{ id: string; name: string }[]>("/lab-tests?limit=1", { token: doctorToken });

  let appointmentUrl = "";
  let prescriptionUrl = "";
  let labOrderUrl = "";

  await test.step("the receptionist registers the patient", async () => {
    const desk = await signedIn(browser, fx.receptionistEmail);
    await desk.getByRole("navigation", { name: "Workspace" }).first().getByRole("link", { name: "Patients" }).click();
    await desk.getByRole("link", { name: "Register patient" }).click();
    await desk.getByLabel("First name").fill("Jyoti");
    await desk.getByLabel("Last name").fill("Journey");
    await desk.getByLabel("Email", { exact: true }).fill(journeyEmail);
    await desk.getByLabel("Mobile (optional)").fill("+919812345678");
    await desk.getByLabel("Date of birth (optional)").fill("1990-04-12");
    await desk.getByRole("button", { name: "Register patient" }).click();
    await expect(desk).toHaveURL(/\/dashboard\/patients\/[0-9a-f-]{36}$/);
    await expect(desk.getByRole("heading", { level: 1, name: "Jyoti Journey" })).toBeVisible();

    await test.step("and books an appointment for them", async () => {
      await desk.getByRole("link", { name: "Book appointment" }).click();
      await desk.getByLabel("Doctor", { exact: true }).selectOption(fx.doctorId);
      await desk.getByRole("button", { name: "Continue" }).click();
      const slots = desk.locator("fieldset button");
      await expect(slots.first()).toBeVisible();
      await slots.first().click();
      await desk.getByRole("button", { name: "Continue" }).click();
      await desk.getByLabel("Reason for visit (optional)").fill("Fever and fatigue for three days");
      await desk.getByRole("button", { name: "Book appointment" }).click();
      await expect(desk.getByRole("heading", { name: "Appointment booked" })).toBeVisible();
      await desk.getByRole("link", { name: "Open appointment" }).click();
      await expect(desk).toHaveURL(/\/dashboard\/appointments\/[0-9a-f-]{36}$/);
      appointmentUrl = new URL(desk.url()).pathname;
      if (await desk.getByRole("button", { name: "Confirm" }).isVisible()) {
        await desk.getByRole("button", { name: "Confirm" }).click();
      }
      await expect(desk.getByText("Confirmed", { exact: true })).toBeVisible();
    });
    await desk.context().close();
  });

  await test.step("the doctor runs the encounter", async () => {
    const doctor = await signedIn(browser, fx.doctorEmail);
    await doctor.goto(appointmentUrl);
    await doctor.getByRole("button", { name: "Start visit" }).click();
    await expect(doctor).toHaveURL(/\/dashboard\/encounters\/[0-9a-f-]{36}$/);
    await expect(doctor.getByLabel("Chief complaint")).toHaveValue("Fever and fatigue for three days");
    await doctor.getByLabel("Diagnosis notes (optional)").fill("Viral fever");
    await doctor.getByLabel("ICD-10 codes (optional)").fill("R50.9");
    await doctor.getByRole("button", { name: "Start encounter" }).click();
    await expect(doctor.getByRole("heading", { name: "Encounter" })).toBeVisible();

    await doctor.getByLabel("Systolic").fill("118");
    await doctor.getByLabel("Diastolic").fill("76");
    await doctor.getByLabel("Pulse (bpm)").fill("72");
    await doctor.getByLabel("Temp (°C)").fill("38.1");
    await doctor.getByRole("button", { name: "Save vitals" }).click();
    await expect(doctor.getByText("118/76 mmHg")).toBeVisible();

    await doctor.getByRole("button", { name: "New prescription" }).click();
    await doctor.getByLabel("Add a medicine").fill(medicine.name.slice(0, 6));
    await doctor.getByRole("list", { name: "Matching medicines" }).getByRole("button", { name: new RegExp(medicine.name) }).first().click();
    await doctor.getByLabel("Dose").fill("500 mg");
    await doctor.getByLabel("Days", { exact: true }).fill("2");
    await doctor.getByLabel("Quantity", { exact: true }).fill("2");
    await doctor.getByRole("button", { name: "Issue prescription" }).click();
    const rxLink = doctor.locator('a[href^="/dashboard/prescriptions/"]');
    await expect(rxLink).toHaveCount(1);
    prescriptionUrl = (await rxLink.getAttribute("href")) ?? "";

    await doctor.getByRole("button", { name: "Order tests" }).click();
    await doctor.getByRole("checkbox", { name: new RegExp(labTest.name) }).check();
    await doctor.getByRole("button", { name: "Order 1 test" }).click();
    const labLink = doctor.locator('a[href^="/dashboard/lab-orders/"]');
    await expect(labLink).toHaveCount(1);
    labOrderUrl = (await labLink.getAttribute("href")) ?? "";
    await doctor.context().close();
  });

  await test.step("a lab technician collects, tests, and enters the result", async () => {
    const lab = await signedIn(browser, fx.labTechEmail);
    await lab.goto(labOrderUrl);
    await lab.getByRole("button", { name: "Mark sample collected" }).click();
    await lab.getByRole("button", { name: "Start testing" }).click();
    await lab.getByLabel(`${labTest.name} result`).fill("13.2");
    await lab.getByRole("button", { name: "Save result" }).click();
    await expect(lab.getByText("You entered this result.", { exact: false })).toBeVisible();
    await expect(lab.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await lab.context().close();
  });

  await test.step("a second technician approves it (four-eyes)", async () => {
    const reviewer = await signedIn(browser, fx.labApproverEmail);
    await reviewer.goto(labOrderUrl);
    await reviewer.getByRole("button", { name: "Approve" }).click();
    await confirmIn(reviewer, "Approve result");
    await expect(reviewer.getByText("Result ready", { exact: true })).toBeVisible();
    await reviewer.context().close();
  });

  await test.step("the pharmacist dispenses the prescription", async () => {
    const pharmacy = await signedIn(browser, `pharmacist@${CITY}`);
    await pharmacy.goto(prescriptionUrl);
    await expect(pharmacy.getByLabel(/Hand over now/)).toHaveValue("2");
    await pharmacy.getByRole("button", { name: "Dispense" }).click();
    await confirmIn(pharmacy, "Dispense");
    await expect(pharmacy.getByText("Dispensed", { exact: true })).toBeVisible();
    await pharmacy.context().close();
  });

  await test.step("the doctor completes the visit", async () => {
    const doctor = await signedIn(browser, fx.doctorEmail);
    await doctor.goto(appointmentUrl.replace("/appointments/", "/encounters/"));
    await doctor.getByRole("button", { name: "Complete visit" }).click();
    await confirmIn(doctor, "Complete visit");
    await expect(doctor.getByText("Completed", { exact: true })).toBeVisible();
    await doctor.context().close();
  });

  await test.step("the front desk finalises the bill and takes cash", async () => {
    const desk = await signedIn(browser, fx.receptionistEmail);
    await desk.goto(appointmentUrl);
    await desk.locator('a[href^="/dashboard/invoices/"]').first().click();
    await expect(desk).toHaveURL(/\/dashboard\/invoices\/[0-9a-f-]{36}$/);
    // Consultation, the lab test, and the dispensed medicine were billed automatically.
    for (const type of ["Consultation", "Lab", "Pharmacy"]) {
      await expect(desk.getByRole("cell", { name: type, exact: true })).toBeVisible();
    }
    await desk.getByRole("button", { name: "Finalise bill" }).click();
    await confirmIn(desk, "Finalise");
    await desk.getByRole("button", { name: "Record cash" }).click();
    await confirmIn(desk, "Record payment");
    await expect(desk.locator('[data-status="PAID"]')).toBeVisible();
    await expect(desk.getByRole("button", { name: "Record cash" })).toHaveCount(0);
    await expect(desk.locator(ALERT)).toHaveCount(0);
    await desk.context().close();
  });

  await test.step("the patient sees the visit in the portal", async () => {
    runFixtureScript("password", fx.runId);
    const patient = await signedIn(browser, journeyEmail);
    await expect(patient).toHaveURL(/\/portal$/);
    await patient.goto("/portal/invoices");
    await expect(patient.getByText("Paid", { exact: true }).first()).toBeVisible();
    await patient.goto("/portal/prescriptions");
    await expect(patient.getByText(medicine.name).first()).toBeVisible();
    await patient.goto("/portal/lab-reports");
    await expect(patient.getByText(labTest.name).first()).toBeVisible();
    await expect(patient.getByText("Result ready", { exact: true }).first()).toBeVisible();
    await patient.context().close();
  });
});

test("workflow screens refuse roles outside their job, and so does the API", async ({ browser }) => {
  const pharmacy = await signedIn(browser, `pharmacist@${CITY}`);
  for (const path of [`/dashboard/encounters/${fx.patientA.appointmentId}`, "/dashboard/patients/new", `/dashboard/invoices/${fx.invoiceA}`]) {
    await pharmacy.goto(path);
    await expect(pharmacy.getByText("This page isn't part of your workspace")).toBeVisible();
  }
  await pharmacy.context().close();

  const lab = await signedIn(browser, fx.labTechEmail);
  await lab.goto(`/dashboard/prescriptions/${fx.prescriptionA}`);
  await expect(lab.getByText("This page isn't part of your workspace")).toBeVisible();
  await lab.context().close();

  // The screens only mirror the API: it refuses the same calls on its own.
  const labToken = await login(fx.labTechEmail, fx.password);
  await expect(api(`/medical-records/by-appointment/${fx.patientA.appointmentId}`, { token: labToken })).rejects.toThrow(/403/);
  const nurseToken = await login(`nurse@${CITY}`, fx.password);
  await expect(api(`/invoices/${fx.invoiceA}`, { token: nurseToken })).rejects.toThrow(/403/);
  await expect(api("/users", { token: nurseToken })).rejects.toThrow(/403/);
});
