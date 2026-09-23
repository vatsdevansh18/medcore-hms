import { Prisma } from "@prisma/client";
import { TenantContext } from "../tenancy/tenant-context";

/**
 * Domain models whose create/update/delete operations are mirrored to
 * AuditLog (docs/09-SECURITY.md SEC-AUDIT-001, docs/03-ARCHITECTURE.md §4).
 * `AuditLog` itself is deliberately excluded to avoid recursively auditing
 * its own writes. High-volume, low-value-to-audit models are also excluded:
 * `RefreshTokenSession` (security-sensitive but reviewed via SEC-AUTHN
 * mechanisms, not audit trail), `NotificationDeliveryLog` (system-generated
 * retry telemetry), `LabTestReferenceRange` (catalog data, not patient data).
 */
const AUDITED_MODELS = new Set<Prisma.ModelName>([
  "Hospital",
  "Department",
  "User",
  "DoctorProfile",
  "PatientProfile",
  "StaffProfile",
  "Room",
  "Bed",
  "Admission",
  "Appointment",
  "MedicalRecord",
  "MedicalRecordAddendum",
  "Vitals",
  "Allergy",
  "VaccinationRecord",
  "FamilyHistoryFlag",
  "Attachment",
  "Medicine",
  "MedicineBatch",
  "Prescription",
  "PrescriptionItem",
  "DispenseRecord",
  "LabTest",
  "LabOrder",
  "LabOrderItem",
  "LabResult",
  "Invoice",
  "InvoiceItem",
  "InsuranceClaim",
  "Payment",
]);

const SINGLE_ROW_WRITE_OPS = new Set(["create", "update", "upsert", "delete"]);
const BULK_WRITE_OPS = new Set(["createMany", "updateMany", "deleteMany"]);

interface DelegateLike {
  findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
}

interface AuditLogDelegateLike {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDelegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function extractIdWhere(args: unknown): { id: string } | null {
  if (!isRecord(args) || !isRecord(args.where)) return null;
  const id = args.where.id;
  return typeof id === "string" ? { id } : null;
}

/**
 * Layer of docs/03-ARCHITECTURE.md §4: mirrors every create/update/delete on
 * an audited model to AuditLog. `beforeData` is captured for `update` and
 * `delete` (via a pre-mutation read on the same, already tenant-scoped,
 * client); `afterData` is the operation's own return value. Bulk operations
 * (createMany/updateMany/deleteMany) don't return individual rows, so they
 * log one summary entry with the query criteria rather than per-row diffs —
 * documented here as an intentional scope limit ("where feasible" per
 * docs/09-SECURITY.md SEC-AUDIT-001), not an oversight.
 */
export const auditLogExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: "audit-log",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!AUDITED_MODELS.has(model)) {
            return query(args);
          }

          // Captured BEFORE any nested Prisma call, not read again afterward.
          // Prisma's internal query-engine round-trip does not reliably
          // preserve Node's AsyncLocalStorage continuation across an awaited
          // query — a nested query made *after* an await here can find
          // TenantContext.getStore() already lost, even though the outer
          // TenantContext.run(...) is still logically "active" from the
          // caller's point of view. Every nested Prisma call below is
          // re-wrapped in TenantContext.run(effectiveStore, ...) using this
          // captured value so it always sees a valid context regardless.
          const store = TenantContext.getStore();
          const actorUserId = store?.userId ?? null;
          const hospitalId = store?.hospitalId ?? null;
          const effectiveStore = store ?? { hospitalId: null, userId: null, bypassTenancy: true };

          // See the equivalent comment in tenant-scoping.extension.ts: args/result
          // types here are huge per-model/per-operation unions that a runtime type
          // guard only intersects with rather than replaces, so we erase to
          // Record<string, unknown> explicitly for this intentionally generic code.
          const argsRecord = args as unknown as Record<string, unknown>;

          if (BULK_WRITE_OPS.has(operation)) {
            const result = await query(args);
            await TenantContext.run(effectiveStore, () =>
              writeAuditRow(client, {
                hospitalId,
                actorUserId,
                action: operation.toUpperCase(),
                entityType: model,
                entityId: "BULK",
                beforeData: null,
                afterData: sanitizeForAudit(argsRecord.where),
              }),
            );
            return result;
          }

          if (!SINGLE_ROW_WRITE_OPS.has(operation)) {
            return query(args);
          }

          let beforeData: Record<string, unknown> | null = null;
          if (operation === "update" || operation === "upsert") {
            const idWhere = extractIdWhere(args);
            if (idWhere) {
              const delegate = (client as unknown as Record<string, DelegateLike>)[
                toDelegateName(model)
              ];
              beforeData = await TenantContext.run(effectiveStore, () =>
                delegate.findUnique({ where: idWhere }),
              );
            }
          }

          const result = await query(args);
          const resultRecord = result as unknown as Record<string, unknown>;

          const afterData = operation === "delete" ? null : sanitizeForAudit(resultRecord);
          const finalBeforeData =
            operation === "delete" ? sanitizeForAudit(resultRecord) : sanitizeForAudit(beforeData);

          const entityId = typeof resultRecord.id === "string" ? resultRecord.id : "UNKNOWN";

          await TenantContext.run(effectiveStore, () =>
            writeAuditRow(client, {
              hospitalId:
                hospitalId ??
                (typeof resultRecord.hospitalId === "string" ? resultRecord.hospitalId : null),
              actorUserId,
              action: operation.toUpperCase(),
              entityType: model,
              entityId,
              beforeData: finalBeforeData,
              afterData,
            }),
          );

          return result;
        },
      },
    },
  }),
);

/** Strips large/sensitive binary fields before they ever reach the audit trail. */
function sanitizeForAudit(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const { notesEncrypted, noteEncrypted, passwordHash, ...safe } = value;
  void notesEncrypted;
  void noteEncrypted;
  void passwordHash;
  return safe;
}

async function writeAuditRow(
  client: unknown,
  row: {
    hospitalId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    beforeData: Record<string, unknown> | null;
    afterData: Record<string, unknown> | null;
  },
): Promise<void> {
  const auditLog = (client as { auditLog: AuditLogDelegateLike }).auditLog;
  await auditLog.create({
    data: {
      hospitalId: row.hospitalId,
      actorUserId: row.actorUserId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      beforeData: row.beforeData ?? undefined,
      afterData: row.afterData ?? undefined,
    },
  });
}
