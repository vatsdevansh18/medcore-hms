import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_FILE, api, login, type PortalFixture } from "./fixture";

const BACKEND_DIR = join(__dirname, "..", "..", "backend");

/** Runs the backend fixture script (see apps/backend/scripts). */
export function runFixtureScript(mode: "setup" | "teardown", runId: string): string {
  return execFileSync(
    "pnpm",
    ["exec", "dotenv", "-e", "../../.env", "--", "ts-node", "--transpile-only", "scripts/e2e-portal-fixture.ts", mode, runId],
    { cwd: BACKEND_DIR, encoding: "utf-8", shell: process.platform === "win32" },
  );
}

/**
 * A fresh patient with a real history, made through the API the way staff
 * would: an encounter with vitals, a prescription, a lab result approved by
 * a second technician (four-eyes), and a finalized, part-paid bill.
 */
export default async function globalSetup(): Promise<void> {
  const runId = Date.now().toString(36);
  const base = JSON.parse(runFixtureScript("setup", runId).trim()) as PortalFixture;
  const pw = base.password;

  const doctor = await login(base.doctorEmail, pw);
  const encounter = (appointmentId: string, chiefComplaint: string) =>
    api<{ id: string }>("/medical-records", {
      method: "POST",
      token: doctor,
      body: {
        appointmentId,
        chiefComplaint,
        presentingSymptoms: "Dry cough for five days, mild fever.",
        diagnosisNotes: "Acute bronchitis",
        treatmentPlan: "Rest, fluids, antibiotic course.",
        notes: "Review in one week if not improving.",
      },
    });
  const recordA = await encounter(base.patientA.appointmentId, "Persistent cough");
  const recordB = await encounter(base.patientB.appointmentId, "Private complaint of patient B");
  await api(`/medical-records/${recordA.id}/vitals`, {
    method: "POST",
    token: doctor,
    body: { bpSystolic: 122, bpDiastolic: 80, pulse: 76, temperatureC: 37.8, spo2: 98 },
  });
  const prescription = await api<{ id: string }>("/prescriptions", {
    method: "POST",
    token: doctor,
    body: {
      medicalRecordId: recordA.id,
      items: [{ medicineId: base.medicineId, dosage: "500 mg", frequency: "TDS", durationDays: 5, quantityPrescribed: 15 }],
    },
  });
  const labOrder = await api<{ id: string; items: { id: string }[] }>("/lab-orders", {
    method: "POST",
    token: doctor,
    body: { medicalRecordId: recordA.id, items: [{ labTestId: base.labTestId }] },
  });

  const labTech = await login(base.labTechEmail, pw);
  const approver = await login(base.labApproverEmail, pw);
  const item = labOrder.items[0].id;
  const itemPath = `/lab-orders/${labOrder.id}/items/${item}`;
  await api(`${itemPath}/status`, { method: "PATCH", token: labTech, body: { status: "SAMPLE_COLLECTED" } });
  await api(`${itemPath}/status`, { method: "PATCH", token: labTech, body: { status: "IN_PROGRESS" } });
  await api(`${itemPath}/result`, {
    method: "PATCH",
    token: labTech,
    body: { values: [{ parameter: "Result", value: 13.4, unit: "g/dL" }] },
  });
  await api(`${itemPath}/approve`, { method: "PATCH", token: approver, body: { decision: "APPROVED" } });

  const receptionist = await login(base.receptionistEmail, pw);
  const drafts = await api<{ id: string }[]>(
    `/invoices?appointmentId=${base.patientA.appointmentId}&status=DRAFT`,
    { token: receptionist },
  );
  const invoiceId = drafts[0].id;
  await api(`/invoices/${invoiceId}/finalize`, { method: "PATCH", token: receptionist });
  const cash = await api<{ receipt: { paymentId: string } }>(`/invoices/${invoiceId}/cash-payment`, {
    method: "POST",
    token: receptionist,
    body: { amount: 100 },
  });

  const fixture: PortalFixture = {
    ...base,
    recordA: recordA.id,
    recordB: recordB.id,
    prescriptionA: prescription.id,
    labOrderA: labOrder.id,
    invoiceA: invoiceId,
    paymentA: cash.receipt.paymentId,
  };
  writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2));
}
