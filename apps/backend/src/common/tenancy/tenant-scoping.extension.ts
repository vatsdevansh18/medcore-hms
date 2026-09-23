import { Prisma } from "@prisma/client";
import { TenantContext } from "./tenant-context";

/**
 * Models that carry their own `hospitalId` column and are therefore subject
 * to automatic tenant scoping. Child/detail tables without a direct
 * `hospitalId` (Vitals, PrescriptionItem, LabOrderItem, InvoiceItem,
 * DispenseRecord, MedicalRecordAddendum, RefreshTokenSession,
 * NotificationDeliveryLog, LabTestReferenceRange, Bed, DoctorAvailability,
 * DoctorAvailabilityException) are deliberately excluded — they rely on
 * Layer 2 (service-layer parent-ownership verification) per
 * docs/03-ARCHITECTURE.md §5. `Hospital` itself and `Address` are excluded
 * because they are not owned by a single tenant.
 */
const TENANT_SCOPED_MODELS = new Set<Prisma.ModelName>([
  "Department",
  "User",
  "DoctorProfile",
  "PatientProfile",
  "StaffProfile",
  "Room",
  "Admission",
  "AuditLog",
  "Appointment",
  "MedicalRecord",
  "Attachment",
  "Medicine",
  "MedicineBatch",
  "Prescription",
  "LabTest",
  "LabOrder",
  "Invoice",
  "Payment",
  "Notification",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function injectWhere(args: Record<string, unknown>, hospitalId: string): void {
  const where = isRecord(args.where) ? args.where : {};
  args.where = { ...where, hospitalId };
}

function injectCreateData(data: unknown, hospitalId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => (isRecord(row) ? { ...row, hospitalId } : row));
  }
  return isRecord(data) ? { ...data, hospitalId } : data;
}

/**
 * Layer 1 of the three-layer tenancy model (docs/03-ARCHITECTURE.md §5):
 * automatically injects/enforces `hospitalId` on every query for a
 * tenant-scoped model, sourced only from the active TenantContext — never
 * from caller-supplied args. Fails closed: a tenant-scoped operation with no
 * active context, or with `bypassTenancy: false` and no hospitalId, throws
 * rather than silently running unscoped.
 */
export const tenantScopingExtension = Prisma.defineExtension({
  name: "tenant-scoping",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const store = TenantContext.requireStore();

        if (store.bypassTenancy) {
          return query(args);
        }

        if (!store.hospitalId) {
          throw new Error(
            `Tenant-scoped operation ${model}.${operation} attempted with no hospitalId in ` +
              "TenantContext and bypassTenancy=false. This should be unreachable for an " +
              "authenticated non-Super-Admin request — refusing to run unscoped.",
          );
        }

        // $allOperations' `args` type is a huge per-model/per-operation union;
        // a type guard only intersects with it rather than replacing it, so
        // operation-specific fields (data/create/where) still wouldn't
        // type-check. This extension is intentionally generic across every
        // model/operation, so we erase to Record<string, unknown> explicitly.
        const scopedArgs: Record<string, unknown> = {
          ...(args as unknown as Record<string, unknown>),
        };

        if (operation === "create") {
          scopedArgs.data = injectCreateData(scopedArgs.data, store.hospitalId);
        } else if (operation === "createMany") {
          scopedArgs.data = injectCreateData(scopedArgs.data, store.hospitalId);
        } else if (operation === "upsert") {
          injectWhere(scopedArgs, store.hospitalId);
          scopedArgs.create = injectCreateData(scopedArgs.create, store.hospitalId);
        } else if (WHERE_OPERATIONS.has(operation)) {
          injectWhere(scopedArgs, store.hospitalId);
        }

        return query(scopedArgs as typeof args);
      },
    },
  },
});
