/**
 * Fixture for the browser E2E suite (apps/frontend/e2e). Run by Playwright's
 * global setup/teardown against the dev database:
 *
 *   ts-node --transpile-only scripts/e2e-portal-fixture.ts setup <runId>
 *   ts-node --transpile-only scripts/e2e-portal-fixture.ts teardown <runId>
 *
 * `setup` creates only what the API can't: two patients with a known
 * password, a second lab technician (result approval is four-eyes), and an
 * IN_PROGRESS visit per patient for a doctor to start an encounter on. All
 * clinical and billing work is then done through the real API, so every
 * business rule and billing invariant applies. It prints the ids as JSON.
 * `teardown` removes everything tied to that run's accounts.
 *
 * `password` (Phase 13B) gives the patient the staff journey registered at
 * the front desk a known password. A front-desk patient only ever gets an
 * emailed set-your-password link (FR-HOSP-004), which a browser test can't
 * read, so this stands in for the patient following that link.
 */
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PASSWORD = "Demo123!";
const HOSPITAL_SLUG = "medcore-city";

const emails = (runId: string) => ({
  patientA: `e2e-a-${runId}@patient.medcore.test`,
  patientB: `e2e-b-${runId}@patient.medcore.test`,
  labApprover: `e2e-lab-${runId}@medcore-city.medcore.test`,
  // Created by the registration journey itself, through the public API.
  registered: `e2e-reg-${runId}@patient.medcore.test`,
  // Registered at the front desk by the Phase 13B staff journey, through the UI.
  journey: `e2e-journey-${runId}@patient.medcore.test`,
});

async function setup(runId: string) {
  const hospital = await prisma.hospital.findUniqueOrThrow({ where: { slug: HOSPITAL_SLUG } });
  const doctor = await prisma.doctorProfile.findFirstOrThrow({
    where: { hospitalId: hospital.id, deletedAt: null },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const e = emails(runId);

  async function patient(email: string, firstName: string) {
    const user = await prisma.user.create({
      data: {
        hospitalId: hospital.id,
        email,
        passwordHash,
        firstName,
        lastName: "Portal",
        role: "PATIENT",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.patientProfile.create({
      data: { userId: user.id, hospitalId: hospital.id, gender: "FEMALE", bloodGroup: "O+" },
    });
    return profile;
  }

  const patientA = await patient(e.patientA, "Asha");
  const patientB = await patient(e.patientB, "Bina");
  await prisma.allergy.create({ data: { patientId: patientA.id, allergen: "Penicillin", reaction: "Rash", severity: "Moderate" } });

  const labApprover = await prisma.user.create({
    data: {
      hospitalId: hospital.id,
      email: e.labApprover,
      passwordHash,
      firstName: "Second",
      lastName: "Reviewer",
      role: "LAB_TECHNICIAN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  async function visit(patientId: string, daysAgo: number) {
    const start = new Date(Date.now() - daysAgo * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    return prisma.appointment.create({
      data: {
        hospitalId: hospital.id,
        patientId,
        doctorId: doctor.id,
        departmentId: doctor.departmentId,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + 30 * 60_000),
        status: "IN_PROGRESS",
        reasonForVisit: "E2E follow-up",
        createdBy: labApprover.id,
      },
    });
  }
  const visitA = await visit(patientA.id, 3);
  const visitB = await visit(patientB.id, 4);

  const labTest = await prisma.labTest.findFirstOrThrow({ where: { hospitalId: hospital.id } });
  const medicine = await prisma.medicine.findFirstOrThrow({ where: { hospitalId: hospital.id, deletedAt: null } });

  process.stdout.write(
    JSON.stringify({
      runId,
      password: PASSWORD,
      hospitalId: hospital.id,
      patientA: { email: e.patientA, profileId: patientA.id, appointmentId: visitA.id },
      patientB: { email: e.patientB, profileId: patientB.id, appointmentId: visitB.id },
      doctorEmail: doctor.user.email,
      doctorId: doctor.id,
      receptionistEmail: `receptionist@${HOSPITAL_SLUG}.medcore.test`,
      labTechEmail: `lab_technician@${HOSPITAL_SLUG}.medcore.test`,
      labApproverEmail: e.labApprover,
      labTestId: labTest.id,
      medicineId: medicine.id,
    }),
  );
}

async function teardown(runId: string) {
  const e = emails(runId);
  const users = await prisma.user.findMany({ where: { email: { in: Object.values(e) } } });
  const userIds = users.map((u) => u.id);
  const profiles = await prisma.patientProfile.findMany({ where: { userId: { in: userIds } } });
  const patientIds = profiles.map((p) => p.id);
  const byPatient = { patientId: { in: patientIds } };

  await prisma.payment.deleteMany({ where: { invoice: byPatient } });
  // Finalized lines are immutable and the subtotal check is deferred, so
  // reopen, delete lines, and delete invoices in one transaction (same as
  // the backend suite's purgeBilling helper).
  await prisma.$transaction([
    prisma.invoice.updateMany({ where: byPatient, data: { status: "DRAFT" } }),
    prisma.invoiceItem.deleteMany({ where: { invoice: byPatient } }),
    prisma.invoice.deleteMany({ where: byPatient }),
  ]);
  await prisma.notification.deleteMany({ where: { recipientUserId: { in: userIds } } });
  await prisma.labResult.deleteMany({ where: { labOrderItem: { labOrder: byPatient } } });
  await prisma.labOrderItem.deleteMany({ where: { labOrder: byPatient } });
  await prisma.labOrder.deleteMany({ where: byPatient });
  await prisma.dispenseRecord.deleteMany({ where: { prescriptionItem: { prescription: byPatient } } });
  await prisma.prescriptionItem.deleteMany({ where: { prescription: byPatient } });
  await prisma.prescription.deleteMany({ where: byPatient });
  await prisma.vitals.deleteMany({ where: { medicalRecord: byPatient } });
  await prisma.medicalRecordAddendum.deleteMany({ where: { medicalRecord: byPatient } });
  await prisma.attachment.deleteMany({ where: { medicalRecord: byPatient } });
  await prisma.medicalRecord.deleteMany({ where: byPatient });
  await prisma.appointment.deleteMany({ where: byPatient });
  await prisma.allergy.deleteMany({ where: byPatient });
  await prisma.patientProfile.deleteMany({ where: { id: { in: patientIds } } });
  // Test accounts only (the backend suite cleans up its own the same way).
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.refreshTokenSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  process.stdout.write(JSON.stringify({ removedUsers: userIds.length }));
}

async function setPassword(runId: string) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const { count } = await prisma.user.updateMany({ where: { email: emails(runId).journey, role: "PATIENT" }, data: { passwordHash } });
  if (count !== 1) throw new Error(`journey patient for run ${runId} not found`);
  process.stdout.write(JSON.stringify({ updated: count }));
}

async function main() {
  const [mode, runId] = process.argv.slice(2);
  if (!runId || !/^[a-z0-9]+$/.test(runId)) throw new Error("usage: e2e-portal-fixture.ts setup|teardown|password <runId>");
  if (mode === "setup") await setup(runId);
  else if (mode === "teardown") await teardown(runId);
  else if (mode === "password") await setPassword(runId);
  else throw new Error(`unknown mode ${mode}`);
}

main()
  .catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.stack : err));
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
