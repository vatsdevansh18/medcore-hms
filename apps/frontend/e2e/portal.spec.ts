import { expect, test, type Page } from "@playwright/test";
import { api, loadFixture, login as apiLogin, type PortalFixture } from "./fixture";

let fx: PortalFixture;
test.beforeAll(() => {
  fx = loadFixture();
});

async function signIn(page: Page, email: string, password = fx.password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signInAsPatient(page: Page) {
  await signIn(page, fx.patientA.email);
  await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
}

/** The app's own alerts (Next.js also renders an empty role="alert" route announcer). */
function appAlert(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/**
 * Clicks a download button and returns the pre-signed URL the new tab went
 * to. Headless Chromium downloads a PDF rather than displaying it, which
 * aborts the tab's navigation, so the request is captured instead.
 */
async function openDownload(page: Page, name: string | RegExp): Promise<string> {
  // Listen on the whole context before clicking: the popup may request the
  // pre-signed URL before a listener on the popup page could be attached
  // (a race seen in Phase 13B with fast attachment links).
  const request = page.context().waitForEvent("request", (r) => /X-Amz-Signature=/.test(r.url()));
  await page.getByRole("button", { name }).first().click();
  return (await request).url();
}

test.describe("authentication", () => {
  test("sends a signed-out visitor to sign-in and back to where they were going", async ({ page }) => {
    await page.goto("/portal/records");
    await expect(page).toHaveURL(/\/login\?next=%2Fportal%2Frecords/);
    await page.getByLabel("Email").fill(fx.patientA.email);
    await page.getByLabel("Password").fill(fx.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/portal\/records$/);
    await expect(page.getByRole("heading", { name: "Medical records" })).toBeVisible();
  });

  test("shows the server's message for a wrong password and validates empty fields", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await signIn(page, fx.patientA.email, "WrongPass1");
    await expect(appAlert(page)).toContainText("Invalid email or password.");
  });

  test("keeps the session across a reload (refresh cookie) and ends it on sign-out", async ({ page }) => {
    await signInAsPatient(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends staff to their own workspace instead of the portal", async ({ page }) => {
    // Phase 13: staff land on their role dashboard (Phase 12 showed a notice).
    await signIn(page, fx.receptionistEmail);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/staff");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("registers a new patient and asks them to verify their email", async ({ page }) => {
    const email = `e2e-reg-${fx.runId}@patient.medcore.test`;
    await page.goto("/register");
    await page.getByLabel("Hospital").selectOption({ label: "MedCore City Hospital — Bengaluru" });
    await page.getByLabel("First name").fill("Reena");
    await page.getByLabel("Last name").fill("Portal");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Newpass123");
    await page.getByLabel("Confirm password").fill("Newpass124");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("The passwords don't match.")).toBeVisible();
    await page.getByLabel("Confirm password").fill("Newpass123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify-email\?email=/);
    await expect(page.getByText(/emailed you a 6-digit code/)).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    // An unverified account can't sign in yet, and the form says why.
    await signIn(page, email, "Newpass123");
    await expect(appAlert(page)).toContainText(/verify your email/i);
    await expect(page.getByRole("link", { name: "Verify now" })).toBeVisible();
  });
});

test.describe("records, prescriptions, lab reports (FR-PORTAL-001)", () => {
  test.beforeEach(async ({ page }) => signInAsPatient(page));

  test("shows the visit record with vitals, notes, and allergies", async ({ page }) => {
    await page.getByRole("link", { name: "Records" }).first().click();
    await expect(page.getByText("Penicillin")).toBeVisible();
    await page.getByRole("link", { name: /Persistent cough/ }).click();
    await expect(page.getByText("Acute bronchitis")).toBeVisible();
    await expect(page.getByText("122/80 mmHg")).toBeVisible();
    await expect(page.getByText("Review in one week if not improving.")).toBeVisible();
  });

  test("downloads the prescription PDF through a short-lived link", async ({ page }) => {
    await page.goto(`/portal/prescriptions/${fx.prescriptionA}`);
    await expect(page.getByRole("heading", { name: /Prescription ·/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: /500 mg/ })).toBeVisible();
    // The PDF is generated by a background job; the page polls until it's ready.
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible({ timeout: 45_000 });
    const url = await openDownload(page, "Download PDF");
    const res = await page.request.get(url);
    expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("shows an approved lab result with its range flag", async ({ page }) => {
    await page.getByRole("link", { name: "Lab reports" }).first().click();
    await expect(page.getByText("1 of 1 results ready")).toBeVisible();
    await page.getByRole("link", { name: /results ready/ }).click();
    await expect(page.getByText("13.4 g/dL")).toBeVisible();
    await expect(page.getByText("Result ready")).toBeVisible();
  });
});

test.describe("bills and payments (FR-PORTAL-001/003)", () => {
  test.beforeEach(async ({ page }) => signInAsPatient(page));

  test("shows the part-paid bill and downloads the cash payment's receipt", async ({ page }) => {
    await page.getByRole("link", { name: "Bills & payments" }).first().click();
    await page.getByRole("link", { name: /Partly paid/ }).first().click();
    await expect(page.getByText("Balance due")).toBeVisible();
    await expect(page.getByText("Cash at counter")).toBeVisible();
    const url = await openDownload(page, "Receipt");
    const res = await page.request.get(url);
    expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("starts online payment and explains when the provider isn't available", async ({ page }) => {
    // No provider keys in this environment: the API answers 503
    // PAYMENT_PROVIDER_UNAVAILABLE and nothing changes (D-030).
    await page.goto(`/portal/invoices/${fx.invoiceA}`);
    await page.getByRole("button", { name: /^Pay / }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("UPI / Netbanking").click();
    await dialog.getByRole("button", { name: "Continue to payment" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByText(/billing counter/)).toBeVisible();
  });

  test("shows the cancelled-checkout banner on return", async ({ page }) => {
    await page.goto(`/portal/invoices/${fx.invoiceA}?checkout=cancelled`);
    await expect(page.getByText("Payment cancelled. You haven't been charged.")).toBeVisible();
  });
});

test.describe("appointments (FR-PORTAL-002)", () => {
  test("books, reschedules, and cancels an appointment", async ({ page }) => {
    await signInAsPatient(page);
    await page.getByRole("link", { name: "Book appointment" }).first().click();

    // Step 1: the fixture's seeded doctor, by name. Picking "the first doctor"
    // broke once the run's own e2e doctor (no hours yet) joined the list.
    const token = await apiLogin(fx.patientA.email, fx.password);
    const seeded = await api<{ user: { lastName: string } }>(`/doctors/${fx.doctorId}`, { token });
    await page.getByRole("button", { name: new RegExp(seeded.user.lastName) }).first().click();
    // Step 2: a time next week (outside the 24h reschedule cutoff).
    await page.getByRole("button", { name: "Next week" }).click();
    const slots = page.locator("fieldset button");
    await expect(slots.first()).toBeVisible();
    await slots.first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    // Step 3: confirm.
    await page.getByLabel("Reason for visit (optional)").fill("Follow-up for cough");
    await page.getByRole("button", { name: "Request appointment" }).click();
    await expect(page.getByRole("heading", { name: "Appointment requested" })).toBeVisible();

    await page.getByRole("link", { name: "View appointment" }).click();
    await expect(page.getByText("Awaiting confirmation")).toBeVisible();
    const before = await page.getByRole("heading", { level: 1 }).textContent();

    await page.getByRole("button", { name: "Reschedule" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("fieldset button").first().click();
    await dialog.getByRole("button", { name: /^Move to/ }).click();
    await expect(page.getByText(/Appointment moved/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(before ?? "");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const cancel = page.getByRole("dialog");
    await cancel.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(cancel.getByText("Tell the hospital why you're cancelling.")).toBeVisible();
    await cancel.getByLabel("Reason").fill("Feeling better");
    await cancel.getByRole("button", { name: "Cancel appointment" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reschedule" })).toHaveCount(0);
  });
});

test.describe("live notifications (FR-NOTIF-003)", () => {
  test("shows a new notification without a reload when staff confirm the patient's appointment", async ({ page }) => {
    await signInAsPatient(page);
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    const unread = async () => Number((await bell.getAttribute("aria-label"))?.match(/(\d+) unread/)?.[1] ?? 0);
    // Let the list load and the socket connect before the event happens.
    await expect.poll(unread).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(1500);
    const before = await unread();

    const patient = await apiLogin(fx.patientA.email, fx.password);
    const from = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const days = await api<{ slots: { start: string; end: string }[] }[]>(
      `/doctors/${fx.doctorId}/availability?dateFrom=${from}&dateTo=${to}`,
      { token: patient },
    );
    const slot = days.flatMap((d) => d.slots)[0];
    const booked = await api<{ id: string }>("/appointments", {
      method: "POST",
      token: patient,
      body: { doctorId: fx.doctorId, scheduledStart: slot.start, scheduledEnd: slot.end },
    });
    const receptionist = await apiLogin(fx.receptionistEmail, fx.password);
    await api(`/appointments/${booked.id}/status`, { method: "PATCH", token: receptionist, body: { status: "CONFIRMED" } });

    await expect.poll(unread, { timeout: 20_000 }).toBe(before + 1);
    await bell.click();
    await page.getByRole("dialog").getByRole("button", { name: /Appointment confirmed/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/portal/appointments/${booked.id}$`));
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  });
});

test.describe("access control (mandatory scenario: a patient can't see another patient's records)", () => {
  test("shows not-found for another patient's record, bill, and lab order, and the API refuses too", async ({ page }) => {
    await signInAsPatient(page);
    await page.goto(`/portal/records/${fx.recordB}`);
    await expect(appAlert(page)).toContainText(/couldn.t find that/);
    await expect(page.getByText("Private complaint of patient B")).toHaveCount(0);

    const token = await apiLogin(fx.patientA.email, fx.password);
    await expect(api(`/medical-records/by-id/${fx.recordB}`, { token })).rejects.toThrow(/404/);
    await expect(api(`/medical-records/${fx.patientB.profileId}`, { token })).rejects.toThrow(/404/);

    const tokenB = await apiLogin(fx.patientB.email, fx.password);
    await expect(api(`/invoices/${fx.invoiceA}`, { token: tokenB })).rejects.toThrow(/404/);
    await expect(api(`/lab-orders/${fx.labOrderA}`, { token: tokenB })).rejects.toThrow(/404/);
    await expect(api(`/payments/${fx.paymentA}/receipt`, { token: tokenB })).rejects.toThrow(/404/);
  });
});
