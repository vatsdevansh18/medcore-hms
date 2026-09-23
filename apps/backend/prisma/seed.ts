/**
 * Seed script — populates reference/master data only: hospitals, addresses,
 * departments, staff/doctor/patient accounts, rooms/beds, medicine catalog,
 * lab test catalog. Hits the demo-data targets in docs/06-DATABASE-DESIGN.md
 * §5 (≥2 hospitals, ≥8 doctors, ≥30 patients) for this master data.
 *
 * Deliberately does NOT seed appointments, medical records, prescriptions,
 * lab orders, or invoices/payments — those are transactional workflows
 * governed by business rules (booking conflicts, FIFO dispensing, invoice
 * total integrity) that don't exist as callable services until Phases 5–10.
 * Inserting that data directly here would either bypass those rules or
 * duplicate them incorrectly. Each phase extends this seed script once its
 * own service layer exists to generate that data correctly.
 *
 * Uses a fixed faker seed for reproducibility across runs.
 */
import { faker } from "@faker-js/faker";
import * as bcrypt from "bcrypt";
import {
  Gender,
  HospitalStatus,
  MedicineForm,
  ReferenceRangeGender,
  RoomType,
  UserRole,
  UserStatus,
} from "@medcore/types";
import { PrismaClient } from "@prisma/client";
import { TenantContext } from "../src/common/tenancy/tenant-context";
import { auditLogExtension } from "../src/common/audit/audit-log.extension";
import { tenantScopingExtension } from "../src/common/tenancy/tenant-scoping.extension";

const DEMO_PASSWORD = "Demo123!";
const BCRYPT_COST = 12;

const prisma = new PrismaClient().$extends(tenantScopingExtension).$extends(auditLogExtension);

const DEPARTMENT_SPECIALIZATIONS: Array<[string, string]> = [
  ["General Medicine", "General Physician"],
  ["Cardiology", "Cardiologist"],
  ["Pediatrics", "Pediatrician"],
  ["Orthopedics", "Orthopedic Surgeon"],
];

interface HospitalSeed {
  name: string;
  slug: string;
  city: string;
  state: string;
}

const HOSPITAL_SEEDS: HospitalSeed[] = [
  { name: "MedCore City Hospital", slug: "medcore-city", city: "Bengaluru", state: "Karnataka" },
  { name: "MedCore Metro Clinic", slug: "medcore-metro", city: "Pune", state: "Maharashtra" },
];

async function hashDemoPassword(): Promise<string> {
  return bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);
}

async function seedHospital(seed: HospitalSeed, passwordHash: string) {
  const address = await prisma.address.create({
    data: {
      line1: faker.location.streetAddress(),
      city: seed.city,
      state: seed.state,
      postalCode: faker.location.zipCode(),
      country: "India",
    },
  });

  const hospital = await TenantContext.bypass(() =>
    prisma.hospital.create({
      data: {
        name: seed.name,
        slug: seed.slug,
        status: HospitalStatus.ACTIVE,
        addressId: address.id,
        contactEmail: `admin@${seed.slug}.medcore.test`,
        contactPhone: faker.phone.number(),
      },
    }),
  );

  await TenantContext.run(
    { hospitalId: hospital.id, userId: null, bypassTenancy: false },
    async () => {
      const departments = await Promise.all(
        DEPARTMENT_SPECIALIZATIONS.map(([name]) =>
          prisma.department.create({ data: { hospitalId: hospital.id, name } }),
        ),
      );

      // Hospital Admin
      const adminUser = await prisma.user.create({
        data: {
          hospitalId: hospital.id,
          email: `hospitaladmin@${seed.slug}.medcore.test`,
          passwordHash,
          role: UserRole.HOSPITAL_ADMIN,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.staffProfile.create({
        data: {
          userId: adminUser.id,
          hospitalId: hospital.id,
          employeeCode: `${seed.slug.toUpperCase()}-ADM-001`,
        },
      });

      // One staff account per remaining operational role, so every seeded
      // hospital has a working login for all nine platform roles.
      const otherStaffRoles: Array<[UserRole, string]> = [
        [UserRole.NURSE, "NUR"],
        [UserRole.RECEPTIONIST, "REC"],
        [UserRole.LAB_TECHNICIAN, "LAB"],
        [UserRole.PHARMACIST, "PHM"],
        [UserRole.ACCOUNTANT, "ACC"],
      ];
      for (const [role, code] of otherStaffRoles) {
        const user = await prisma.user.create({
          data: {
            hospitalId: hospital.id,
            email: `${role.toLowerCase()}@${seed.slug}.medcore.test`,
            passwordHash,
            role,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        await prisma.staffProfile.create({
          data: {
            userId: user.id,
            hospitalId: hospital.id,
            employeeCode: `${seed.slug.toUpperCase()}-${code}-001`,
          },
        });
      }

      // Doctors — 4 per hospital, one per department, across specializations.
      for (let i = 0; i < DEPARTMENT_SPECIALIZATIONS.length; i++) {
        const department = departments[i]!;
        const [, specialization] = DEPARTMENT_SPECIALIZATIONS[i]!;
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const doctorUser = await prisma.user.create({
          data: {
            hospitalId: hospital.id,
            email: `dr.${firstName}.${lastName}@${seed.slug}.medcore.test`.toLowerCase(),
            passwordHash,
            role: UserRole.DOCTOR,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        const doctorProfile = await prisma.doctorProfile.create({
          data: {
            userId: doctorUser.id,
            hospitalId: hospital.id,
            departmentId: department.id,
            specialization,
            licenseNumber: faker.string.alphanumeric({ length: 10, casing: "upper" }),
            qualification: "MBBS, MD",
            yearsOfExperience: faker.number.int({ min: 2, max: 25 }),
            consultationFee: faker.number.int({ min: 300, max: 1500 }),
          },
        });

        // Mon–Fri, 09:00–13:00, 30-minute slots.
        for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek++) {
          await prisma.doctorAvailability.create({
            data: {
              doctorId: doctorProfile.id,
              dayOfWeek,
              startTime: "09:00",
              endTime: "13:00",
              slotDurationMinutes: 30,
            },
          });
        }
      }

      // Patients — 15 per hospital.
      for (let i = 0; i < 15; i++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const patientAddress = await prisma.address.create({
          data: {
            line1: faker.location.streetAddress(),
            city: seed.city,
            state: seed.state,
            postalCode: faker.location.zipCode(),
            country: "India",
          },
        });
        const patientUser = await prisma.user.create({
          data: {
            hospitalId: hospital.id,
            email: `${firstName}.${lastName}.${i}@patient.medcore.test`.toLowerCase(),
            passwordHash,
            role: UserRole.PATIENT,
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date(),
          },
        });
        await prisma.patientProfile.create({
          data: {
            userId: patientUser.id,
            hospitalId: hospital.id,
            dob: faker.date.birthdate({ min: 5, max: 85, mode: "age" }),
            gender: faker.helpers.arrayElement([Gender.MALE, Gender.FEMALE, Gender.OTHER]),
            bloodGroup: faker.helpers.arrayElement([
              "A+",
              "A-",
              "B+",
              "B-",
              "AB+",
              "AB-",
              "O+",
              "O-",
            ]),
            emergencyContactName: faker.person.fullName(),
            emergencyContactPhone: faker.phone.number(),
            addressId: patientAddress.id,
          },
        });
      }

      // Rooms & beds — 2 general wards per department's first two departments.
      for (const department of departments.slice(0, 2)) {
        const room = await prisma.room.create({
          data: {
            hospitalId: hospital.id,
            departmentId: department.id,
            roomNumber: `${faker.number.int({ min: 100, max: 499 })}`,
            type: RoomType.GENERAL,
          },
        });
        for (let b = 1; b <= 4; b++) {
          await prisma.bed.create({ data: { roomId: room.id, bedNumber: `B${b}` } });
        }
      }

      // Medicine catalog — 5 medicines, 2 batches each (one near-expiry to
      // exercise expiry/low-stock logic once Phase 9 builds against this data).
      const medicineCatalog: Array<[string, MedicineForm]> = [
        ["Paracetamol 500mg", MedicineForm.TABLET],
        ["Amoxicillin 250mg", MedicineForm.CAPSULE],
        ["Cetirizine 10mg", MedicineForm.TABLET],
        ["Amoxiclav Syrup", MedicineForm.SYRUP],
        ["Insulin Glargine", MedicineForm.INJECTION],
      ];
      for (const [name, form] of medicineCatalog) {
        const medicine = await prisma.medicine.create({
          data: { hospitalId: hospital.id, name, form, unit: "unit", reorderLevel: 20 },
        });
        await prisma.medicineBatch.create({
          data: {
            medicineId: medicine.id,
            hospitalId: hospital.id,
            batchNumber: faker.string.alphanumeric({ length: 8, casing: "upper" }),
            manufacturingDate: faker.date.past({ years: 1 }),
            expiryDate: faker.date.future({ years: 2 }),
            quantityOnHand: faker.number.int({ min: 50, max: 500 }),
            unitCost: faker.number.float({ min: 1, max: 50, fractionDigits: 2 }),
            mrp: faker.number.float({ min: 2, max: 80, fractionDigits: 2 }),
          },
        });
        await prisma.medicineBatch.create({
          data: {
            medicineId: medicine.id,
            hospitalId: hospital.id,
            batchNumber: faker.string.alphanumeric({ length: 8, casing: "upper" }),
            manufacturingDate: faker.date.past({ years: 2 }),
            expiryDate: faker.date.soon({ days: 20 }),
            quantityOnHand: faker.number.int({ min: 5, max: 50 }),
            unitCost: faker.number.float({ min: 1, max: 50, fractionDigits: 2 }),
            mrp: faker.number.float({ min: 2, max: 80, fractionDigits: 2 }),
          },
        });
      }

      // Lab test catalog with reference ranges.
      const labTestCatalog: Array<[string, string, string, number, string]> = [
        ["Haemoglobin", "HB", "g/dL", 13.0, "17.5"],
        ["Fasting Blood Sugar", "FBS", "mg/dL", 70, "100"],
        ["Total Cholesterol", "CHOL", "mg/dL", 0, "200"],
        ["TSH", "TSH", "mIU/L", 0.4, "4.0"],
        ["Platelet Count", "PLT", "10^3/uL", 150, "450"],
      ];
      for (const [name, code, unit, low, highStr] of labTestCatalog) {
        const labTest = await prisma.labTest.create({
          data: {
            hospitalId: hospital.id,
            name,
            code,
            price: faker.number.int({ min: 150, max: 1200 }),
            turnaroundHours: faker.helpers.arrayElement([4, 12, 24]),
          },
        });
        await prisma.labTestReferenceRange.create({
          data: {
            labTestId: labTest.id,
            gender: ReferenceRangeGender.ANY,
            lowValue: low,
            highValue: Number(highStr),
            unit,
          },
        });
      }
    },
  );
}

async function main() {
  faker.seed(42);
  const passwordHash = await hashDemoPassword();

  await TenantContext.bypass(() =>
    prisma.user.create({
      data: {
        email: "superadmin@medcore.test",
        passwordHash,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    }),
  );

  for (const hospitalSeed of HOSPITAL_SEEDS) {
    await seedHospital(hospitalSeed, passwordHash);
  }

  // eslint-disable-next-line no-console -- seed script summary output is expected
  console.log(`Seed complete. Demo password for every seeded account: ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
