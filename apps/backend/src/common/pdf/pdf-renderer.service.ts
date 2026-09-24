import { Injectable } from "@nestjs/common";
import puppeteer from "puppeteer";

/** Escapes text for interpolation into the PDF templates' HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a self-contained HTML document to an A4 PDF with headless
 * Chromium. Shared by the prescription PDF job (FR-RX-003) and payment
 * receipts (Phase 12). Templates must not reference external resources
 * other than pre-signed S3 images: Chromium fetches everything before
 * printing. On Alpine the system Chromium is used via
 * PUPPETEER_EXECUTABLE_PATH (docs/11-DECISIONS.md D-016).
 */
@Injectable()
export class PdfRendererService {
  async render(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      return Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    } finally {
      await browser.close();
    }
  }
}
