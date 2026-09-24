/**
 * Demo history (Phase 13): two weeks of past activity plus a week of
 * upcoming bookings for every seeded hospital, so the role dashboards have
 * something real to show (brief: "an appointment history covering 2 weeks";
 * docs/06-DATABASE-DESIGN.md §5). Run after `db:seed`:
 *
 *   pnpm run db:seed:history
 *
 * It writes the rows the services would have written, respecting the rules
 * those services and the database enforce:
 * - appointments sit on each doctor's schedule in the hospital's timezone,
 *   never overlap for a doctor or a patient (the exclusion constraints
 *   would refuse them anyway);
 * - an invoice's lines satisfy lineTotal = quantity × unitPrice and
 *   subtotal = Σ lineTotal, are written while it's DRAFT, and its final
 *   status matches the SUCCEEDED payments against it;
 * - a lab result is entered by one technician and approved by another.
 * It does not dispense medicines (stock changes belong to the FEFO
 * dispensing service), so prescriptions stay ISSUED.
 *
 * Idempotent per hospital: a hospital that already has seeded history is
 * skipped. Deterministic (fixed faker seed) apart from "today".
 */
import { faker } from "@faker-js/faker";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  AppointmentStatus,
  BedStatus,
  InvoiceItemSourceType,
  InvoiceStatus,
  LabOrderItemStatus,
  LabOrderPriority,
  LabResultFlag,
  PaymentMethod,
  PaymentStatus,
  PrescriptionFrequency,
  UserRole,
} from "@medcore/types";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { auditLogExtension } from "../src/common/audit/audit-log.extension";
import { tenantScopingExtension } from "../src/common/tenancy/tenant-scoping.extension";
import { addDaysToKey, localDateKey, weekdayOf, zonedWallTimeToUtc } from "../src/common/time/zoned-time";

const prisma = new PrismaClient().$extends(tenantScopingExtension).$extends(auditLogExtension);
const MARKER = "seed-history";

/** Progress output (a seed script's summary is expected, as in seed.ts). */
function log(message: string): void {
  // eslint-disable-next-line no-console -- seed script summary output is expected
  console.log(message);
}
const PAST_DAYS = 14;
const FUTURE_DAYS = 7;

const COMPLAINTS: Array<[string, string, string]> = [
  ["Fever and body ache", "Viral fever", "Rest, fluids, paracetamol for fever."],
  ["Persistent cough", "Acute bronchitis", "Steam inhalation; review in a week."],
  ["Chest discomfort on exertion", "Stable angina, to evaluate", "ECG and lipid profile; lifestyle advice."],
  ["Knee pain after a fall", "Soft-tissue knee injury", "Ice, compression, analgesics; physiotherapy."],
  ["Headache for three days", "Tension-type headache", "Analgesics as needed; sleep hygiene."],
  ["Routine diabetes follow-up", "Type 2 diabetes mellitus", "Continue metformin; repeat FBS in 3 months."],
  ["Child with ear pain", "Acute otitis media", "Antibiotic course; review if not better in 3 days."],
  ["Dizziness on standing", "Postural hypotension", "Hydration; review medications."],
];

function money(value: Prisma.Decimal | number): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

async function seedHospital(hospitalId: string, name: string, timeZone: string): Promise<void> {
  const scoped = <T>(fn: () => Promise<T>) =>
    TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, fn);

  const already = await scoped(() => prisma.appointment.count({ where: { hospitalId, createdBy: MARKER } }));
  if (already > 0) {
    log(`  ${name}: history already present (${already} appointments), skipped.`);
    return;
  }

  const [doctors, patients, labTests, medicines, labTechs, receptionist, beds] = await scoped(() =>
    Promise.all([
      prisma.doctorProfile.findMany({
        where: { hospitalId, deletedAt: null },
        include: { availability: { where: { isActive: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.patientProfile.findMany({ where: { hospitalId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
      prisma.labTest.findMany({ where: { hospitalId }, orderBy: { name: "asc" } }),
      prisma.medicine.findMany({ where: { hospitalId, deletedAt: null }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { hospitalId, role: UserRole.LAB_TECHNICIAN }, orderBy: { createdAt: "asc" } }),
      prisma.user.findFirst({ where: { hospitalId, role: UserRole.RECEPTIONIST } }),
      prisma.bed.findMany({ where: { room: { hospitalId } }, orderBy: { bedNumber: "asc" } }),
    ]),
  );
  if (doctors.length === 0 || patients.length < 8 || !receptionist) {
    log(`  ${name}: not enough master data (run db:seed first), skipped.`);
    return;
  }
  // Four-eyes approval needs a second technician; add one if the seed has only one.
  let approver = labTechs[1];
  const enterer = labTechs[0];
  if (enterer && !approver) {
    approver = await scoped(() =>
      prisma.user.create({
        data: {
          hospitalId,
          email: `lab_reviewer@${name.toLowerCase().replace(/[^a-z]+/g, "-")}.medcore.test`,
          passwordHash: enterer.passwordHash,
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          role: UserRole.LAB_TECHNICIAN,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      }),
    );
  }

  const today = localDateKey(new Date(), timeZone);
  const now = Date.now();
  let appointments = 0;
  let invoices = 0;

  for (let offset = -PAST_DAYS; offset <= FUTURE_DAYS; offset++) {
    const day = addDaysToKey(today, offset);
    const weekday = weekdayOf(day);
    // Patients already booked at each start instant today (no patient overlap).
    const busy = new Map<number, Set<string>>();

    for (const doctor of doctors) {
      const windows = doctor.availability.filter((w) => w.dayOfWeek === weekday);
      for (const window of windows) {
        const slots: Date[] = [];
        let cursor = zonedWallTimeToUtc(day, window.startTime, timeZone);
        const windowEnd = zonedWallTimeToUtc(day, window.endTime, timeZone);
        while (cursor.getTime() + window.slotDurationMinutes * 60_000 <= windowEnd.getTime()) {
          slots.push(cursor);
          cursor = new Date(cursor.getTime() + window.slotDurationMinutes * 60_000);
        }
        // Busier on weekdays near today; 40-75% of slots booked.
        const booked = faker.helpers.arrayElements(slots, Math.round(slots.length * faker.number.float({ min: 0.4, max: 0.75 })));
        for (const start of booked.sort((a, b) => a.getTime() - b.getTime())) {
          const taken = busy.get(start.getTime()) ?? new Set<string>();
          const candidates = patients.filter((p) => !taken.has(p.id));
          if (candidates.length === 0) continue;
          const patient = faker.helpers.arrayElement(candidates);
          taken.add(patient.id);
          busy.set(start.getTime(), taken);
          const end = new Date(start.getTime() + window.slotDurationMinutes * 60_000);

          let status: AppointmentStatus;
          if (end.getTime() < now) {
            status = faker.helpers.weightedArrayElement([
              { weight: 80, value: AppointmentStatus.COMPLETED },
              { weight: 10, value: AppointmentStatus.NO_SHOW },
              { weight: 10, value: AppointmentStatus.CANCELLED },
            ]);
          } else if (start.getTime() <= now) {
            status = AppointmentStatus.IN_PROGRESS;
          } else if (offset === 0) {
            status = faker.helpers.arrayElement([AppointmentStatus.CONFIRMED, AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING]);
          } else {
            status = faker.helpers.arrayElement([AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING]);
          }
          const [complaint, diagnosis, plan] = faker.helpers.arrayElement(COMPLAINTS);

          await scoped(async () => {
            const appointment = await prisma.appointment.create({
              data: {
                hospitalId,
                patientId: patient.id,
                doctorId: doctor.id,
                departmentId: doctor.departmentId,
                scheduledStart: start,
                scheduledEnd: end,
                status,
                reasonForVisit: complaint,
                createdBy: MARKER,
                createdAt: new Date(start.getTime() - faker.number.int({ min: 1, max: 5 }) * 86_400_000),
                ...(status === AppointmentStatus.CANCELLED
                  ? { cancelledReason: "Patient unable to attend", cancelledBy: receptionist.id }
                  : {}),
              },
            });
            appointments += 1;
            if (status !== AppointmentStatus.COMPLETED) return;

            // The encounter, its charges, and what the doctor ordered.
            const record = await prisma.medicalRecord.create({
              data: {
                hospitalId,
                appointmentId: appointment.id,
                patientId: patient.id,
                doctorId: doctor.id,
                chiefComplaint: complaint,
                presentingSymptoms: complaint,
                diagnosisNotes: diagnosis,
                treatmentPlan: plan,
                createdAt: new Date(start.getTime() + 10 * 60_000),
              },
            });
            await prisma.vitals.create({
              data: {
                medicalRecordId: record.id,
                bpSystolic: faker.number.int({ min: 105, max: 150 }),
                bpDiastolic: faker.number.int({ min: 65, max: 95 }),
                pulse: faker.number.int({ min: 62, max: 104 }),
                temperatureC: faker.number.float({ min: 36.4, max: 38.6, fractionDigits: 1 }),
                spo2: faker.number.int({ min: 94, max: 100 }),
                recordedBy: doctor.userId,
                recordedAt: new Date(start.getTime() + 5 * 60_000),
              },
            });

            const lines: { sourceType: InvoiceItemSourceType; description: string; quantity: number; unitPrice: Prisma.Decimal }[] = [
              {
                sourceType: InvoiceItemSourceType.CONSULTATION,
                description: `Consultation: ${doctor.specialization}`,
                quantity: 1,
                unitPrice: money(doctor.consultationFee),
              },
            ];

            if (medicines.length > 0 && faker.datatype.boolean({ probability: 0.5 })) {
              await prisma.prescription.create({
                data: {
                  hospitalId,
                  medicalRecordId: record.id,
                  doctorId: doctor.id,
                  patientId: patient.id,
                  createdAt: new Date(start.getTime() + 20 * 60_000),
                  items: {
                    create: faker.helpers.arrayElements(medicines, { min: 1, max: 2 }).map((medicine) => ({
                      medicineId: medicine.id,
                      dosage: "1 tablet",
                      frequency: faker.helpers.arrayElement([PrescriptionFrequency.OD, PrescriptionFrequency.BD, PrescriptionFrequency.TDS]),
                      durationDays: faker.helpers.arrayElement([3, 5, 7, 14]),
                      quantityPrescribed: faker.helpers.arrayElement([10, 15, 20]),
                    })),
                  },
                },
              });
            }

            if (labTests.length > 0 && enterer && approver && faker.datatype.boolean({ probability: 0.35 })) {
              const test = faker.helpers.arrayElement(labTests);
              const ageMs = now - end.getTime();
              // Older orders are finished; the last day's are still in the lab.
              const itemStatus = ageMs > 36 * 3_600_000
                ? LabOrderItemStatus.APPROVED
                : faker.helpers.arrayElement([LabOrderItemStatus.SAMPLE_COLLECTED, LabOrderItemStatus.IN_PROGRESS, LabOrderItemStatus.RESULT_UPLOADED]);
              const order = await prisma.labOrder.create({
                data: {
                  hospitalId,
                  medicalRecordId: record.id,
                  doctorId: doctor.id,
                  patientId: patient.id,
                  priority: faker.datatype.boolean({ probability: 0.2 }) ? LabOrderPriority.URGENT : LabOrderPriority.ROUTINE,
                  createdAt: new Date(start.getTime() + 25 * 60_000),
                  items: { create: [{ labTestId: test.id, status: itemStatus }] },
                },
                include: { items: true },
              });
              if (itemStatus === LabOrderItemStatus.APPROVED || itemStatus === LabOrderItemStatus.RESULT_UPLOADED) {
                const flag = faker.helpers.weightedArrayElement([
                  { weight: 7, value: LabResultFlag.NORMAL },
                  { weight: 2, value: LabResultFlag.HIGH },
                  { weight: 1, value: LabResultFlag.LOW },
                ]);
                await prisma.labResult.create({
                  data: {
                    labOrderItemId: order.items[0].id,
                    structuredValues: [
                      { parameter: test.name, value: faker.number.float({ min: 4, max: 200, fractionDigits: 1 }), unit: "units", flag },
                    ],
                    isOutOfRange: flag !== LabResultFlag.NORMAL,
                    enteredBy: enterer.id,
                    ...(itemStatus === LabOrderItemStatus.APPROVED
                      ? { approvedBy: approver.id, approvedAt: new Date(end.getTime() + 6 * 3_600_000) }
                      : {}),
                  },
                });
              }
              lines.push({ sourceType: InvoiceItemSourceType.LAB, description: `Lab test: ${test.name}`, quantity: 1, unitPrice: money(test.price) });
            }

            // The visit's invoice: lines while DRAFT, then the final status the
            // payments justify (the order the billing triggers require).
            const subtotal = lines.reduce((sum, line) => sum.add(line.unitPrice.mul(line.quantity)), new Prisma.Decimal(0));
            const invoice = await prisma.invoice.create({
              data: {
                hospitalId,
                appointmentId: appointment.id,
                patientId: patient.id,
                subtotal,
                total: subtotal,
                createdAt: end,
                items: {
                  create: lines.map((line) => ({ ...line, lineTotal: line.unitPrice.mul(line.quantity), createdAt: end })),
                },
              },
            });
            invoices += 1;
            const finalizedAt = new Date(end.getTime() + 15 * 60_000);
            if (finalizedAt.getTime() > now) return; // today's visit, still being billed

            const outcome = faker.helpers.weightedArrayElement([
              { weight: 70, value: "paid" },
              { weight: 12, value: "partial" },
              { weight: 18, value: "unpaid" },
            ]);
            const paidAt = new Date(finalizedAt.getTime() + faker.number.int({ min: 5, max: 90 }) * 60_000);
            let paid = new Prisma.Decimal(0);
            if (outcome !== "unpaid" && paidAt.getTime() <= now) {
              paid = outcome === "paid" ? subtotal : money(subtotal.mul(0.5));
              await prisma.payment.create({
                data: {
                  hospitalId,
                  invoiceId: invoice.id,
                  method: faker.helpers.weightedArrayElement([
                    { weight: 5, value: PaymentMethod.CASH },
                    { weight: 3, value: PaymentMethod.STRIPE },
                    { weight: 2, value: PaymentMethod.RAZORPAY },
                  ]),
                  amount: paid,
                  status: PaymentStatus.SUCCEEDED,
                  providerSignatureVerified: true,
                  recordedBy: receptionist.id,
                  createdAt: paidAt,
                },
              });
            }
            const invoiceStatus = paid.gte(subtotal)
              ? InvoiceStatus.PAID
              : paid.gt(0)
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.FINALIZED;
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { status: invoiceStatus, finalizedAt, finalizedBy: receptionist.id },
            });
          });
        }
      }
    }
  }

  // A few inpatients, so the bed board isn't empty.
  const vacant = beds.filter((bed) => bed.status === BedStatus.VACANT);
  const toOccupy = vacant.slice(0, Math.ceil(vacant.length / 3));
  for (const bed of toOccupy) {
    await scoped(async () => {
      await prisma.admission.create({
        data: {
          hospitalId,
          patientId: faker.helpers.arrayElement(patients).id,
          bedId: bed.id,
          admittedAt: new Date(now - faker.number.int({ min: 1, max: 5 }) * 86_400_000),
          admittedBy: receptionist.id,
        },
      });
      await prisma.bed.update({ where: { id: bed.id }, data: { status: BedStatus.OCCUPIED } });
    });
  }
  const maintenance = vacant[vacant.length - 1];
  if (maintenance && !toOccupy.includes(maintenance)) {
    await scoped(() => prisma.bed.update({ where: { id: maintenance.id }, data: { status: BedStatus.MAINTENANCE } }));
  }

  log(`  ${name}: ${appointments} appointments, ${invoices} invoices, ${toOccupy.length} admissions.`);
}

async function main(): Promise<void> {
  faker.seed(1302);
  const hospitals = await TenantContext.bypass(() =>
    prisma.hospital.findMany({ where: { status: "ACTIVE", slug: { in: ["medcore-city", "medcore-metro"] } }, orderBy: { name: "asc" } }),
  );
  if (hospitals.length === 0) throw new Error("No seeded hospitals found. Run `pnpm run db:seed` first.");
  log("Seeding demo history:");
  for (const hospital of hospitals) {
    await seedHospital(hospital.id, hospital.name, hospital.timezone);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
