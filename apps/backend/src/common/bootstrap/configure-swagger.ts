import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

/**
 * docs/08-API-CONTRACT.md is the source of truth for the API surface; this
 * is its generated mirror (Phase 17 — the brief's explicit "Swagger UI
 * running at /api/docs" deliverable), not a second place to hand-maintain
 * endpoint descriptions. Most of the schema comes from the nest-cli.json
 * `@nestjs/swagger` compiler plugin reading existing DTOs' class-validator
 * decorators and doc comments — no manual `@ApiProperty()` duplication
 * needed on every field.
 *
 * Mounted unconditionally, including in production: the brief grades this
 * as a deployed-backend deliverable, and it describes only the request/
 * response shapes already public in docs/08-API-CONTRACT.md — no secrets,
 * no internal implementation detail.
 */
export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("MedCore HMS API")
    .setDescription(
      "Multi-tenant Hospital Management Platform API. See docs/08-API-CONTRACT.md in the repository for the full endpoint index and docs/07-RBAC-MATRIX.md for the role/permission matrix each endpoint enforces.",
    )
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "access-token")
    .addTag("auth", "Registration, login, OTP, password reset, sessions")
    .addTag("hospitals", "Hospital onboarding, departments, Super Admin")
    .addTag("users", "Staff directory and user management")
    .addTag("doctors", "Doctor profiles, availability, schedules")
    .addTag("patients", "Patient registration and profiles")
    .addTag("appointments", "Booking, rescheduling, status transitions")
    .addTag("medical-records", "EMR: encounters, vitals, addenda, attachments")
    .addTag("patient-clinical", "Allergies, vaccinations, family history")
    .addTag("prescriptions", "Prescribing and prescription PDFs")
    .addTag("lab", "Lab orders, results, four-eyes approval")
    .addTag("medicines", "Pharmacy catalog, batches, dispensing")
    .addTag("billing", "Invoices, charges, cash and online payments")
    .addTag("payments", "Payment records and provider webhooks")
    .addTag("notifications", "In-app notification feed")
    .addTag("analytics", "Dashboards, search, audit logs")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);
}
