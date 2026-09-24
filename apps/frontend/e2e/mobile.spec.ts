import { expect, test } from "@playwright/test";
import { loadFixture } from "./fixture";

/** The portal is mobile-first (docs/04-UI-UX.md §4): navigation moves into
 * a drawer and nothing scrolls sideways. */
test("navigates the portal from the phone menu without horizontal scrolling", async ({ page }) => {
  const fx = loadFixture();
  await page.goto("/login");
  await page.getByLabel("Email").fill(fx.patientA.email);
  await page.getByLabel("Password").fill(fx.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Hello, Asha" })).toBeVisible();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Bills & payments" }).click();
  await expect(page.getByRole("heading", { name: "Bills & payments" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  for (const path of ["/portal", "/portal/invoices", `/portal/invoices/${fx.invoiceA}`, `/portal/records/${fx.recordA}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
