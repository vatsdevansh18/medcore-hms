import { HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ApiErrorCode,
  LabOrderItemStatus,
  LabOrderPriority,
  LabResultDecision,
  LabResultFlag,
  InvoiceItemSourceType,
  NotificationType,
  UserRole,
} from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import { ChargesService } from "../billing/charges.service";
import { NotificationsService, type NotificationDb } from "../notifications/notifications.service";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { AppException } from "../common/errors/app-exception";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { S3Service } from "../common/storage/s3.service";
import { validateAttachment } from "../emr/attachment-validation";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { computeFlag, selectReferenceRange } from "./lab-reference-range.util";
import type { CreateLabOrderDto } from "./dto/create-lab-order.dto";
import type { UpdateLabOrderItemStatusDto } from "./dto/update-lab-order-item-status.dto";
import type { EnterLabResultDto } from "./dto/enter-lab-result.dto";
import type { ApproveLabResultDto } from "./dto/approve-lab-result.dto";
import type { FindLabOrdersQueryDto } from "./dto/find-lab-orders-query.dto";
import { PaginatedResult } from "../common/pagination/paginated-result";
import { DOCTOR_NAME_SELECT } from "../prescriptions/prescription-view";

interface StoredLabValue {
  parameter: string;
  value: number;
  unit: string;
  flag: LabResultFlag;
}

const LAB_ORDER_INCLUDE = {
  doctor: {
    select: {
      id: true,
      userId: true,
      specialization: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  patient: { include: { user: { select: SAFE_USER_SELECT } } },
  items: { include: { labTest: { include: { referenceRanges: true } }, result: true } },
} as const;

/** docs/07-RBAC-MATRIX.md §3.6 "Update order status" — REC is restricted to
 * the single ORDERED->SAMPLE_COLLECTED "collect sample" transition; LAB can
 * additionally drive SAMPLE_COLLECTED->IN_PROGRESS. Read as `role ->
 * fromStatus -> allowed target statuses`, same shape as the Phase 5
 * appointments state machine. */
const ALLOWED_STATUS_TRANSITIONS: Partial<Record<UserRole, Partial<Record<LabOrderItemStatus, LabOrderItemStatus[]>>>> = {
  [UserRole.RECEPTIONIST]: {
    [LabOrderItemStatus.ORDERED]: [LabOrderItemStatus.SAMPLE_COLLECTED],
  },
  [UserRole.LAB_TECHNICIAN]: {
    [LabOrderItemStatus.ORDERED]: [LabOrderItemStatus.SAMPLE_COLLECTED],
    [LabOrderItemStatus.SAMPLE_COLLECTED]: [LabOrderItemStatus.IN_PROGRESS],
  },
};

/** docs/07-RBAC-MATRIX.md §3.6 "View result" row's role set for `GET
 * /lab-orders/:id`. RECEPTIONIST/PHARMACIST/ACCOUNTANT have no access at all. */
const VIEW_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECHNICIAN, UserRole.PATIENT];

type LabOrderWithChildren = Prisma.LabOrderGetPayload<{ include: typeof LAB_ORDER_INCLUDE }>;

@Injectable()
export class LabService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly s3: S3Service,
    private readonly charges: ChargesService,
    private readonly notifications: NotificationsService,
  ) {}

  private async requireHospitalId(caller: AuthenticatedUser): Promise<string> {
    if (!caller.hospitalId) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A hospital-scoped account is required for laboratory access.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return caller.hospitalId;
  }

  async create(dto: CreateLabOrderDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const medicalRecord = await this.prisma.medicalRecord.findUnique({
        where: { id: dto.medicalRecordId },
        include: { doctor: true },
      });
      if (!medicalRecord) throw new NotFoundException("Medical record not found.");
      if (medicalRecord.doctor.userId !== caller.sub) {
        // FR-LAB-001 "own encounter" — same not-found-not-forbidden pattern
        // as EMR/Prescriptions for an adjacent doctor.
        throw new NotFoundException("Medical record not found.");
      }

      const labTestIds = [...new Set(dto.items.map((item) => item.labTestId))];
      const labTests = await this.prisma.labTest.findMany({ where: { id: { in: labTestIds } } });
      if (labTests.length !== labTestIds.length) {
        throw new AppException(
          ApiErrorCode.VALIDATION_ERROR,
          "One or more lab tests were not found in your hospital's catalog.",
          HttpStatus.BAD_REQUEST,
        );
      }

      const testsById = new Map(labTests.map((t) => [t.id, t]));
      // FR-BILL-001: each ordered test is charged in the same transaction
      // as the order itself (appointment lock first, the billing lock order).
      return this.prisma.$transaction(async (tx) => {
        await this.charges.lockAppointment(tx, hospitalId, medicalRecord.appointmentId);
        const order = await tx.labOrder.create({
          data: {
            hospitalId,
            medicalRecordId: medicalRecord.id,
            doctorId: medicalRecord.doctorId,
            patientId: medicalRecord.patientId,
            priority: dto.priority ?? LabOrderPriority.ROUTINE,
            items: { create: dto.items.map((item) => ({ labTestId: item.labTestId })) },
          },
          include: LAB_ORDER_INCLUDE,
        });
        await this.charges.addCharges(
          tx,
          hospitalId,
          medicalRecord.appointmentId,
          order.items.map((item) => {
            const test = testsById.get(item.labTestId)!;
            return {
              sourceType: InvoiceItemSourceType.LAB,
              sourceId: item.id,
              description: `Lab test: ${test.name}`,
              quantity: 1,
              unitPrice: test.price,
            };
          }),
        );
        return order;
      });
    });
  }

  private async getOrderForStaff(id: string, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);
    const order = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.labOrder.findUnique({ where: { id }, include: LAB_ORDER_INCLUDE }),
    );
    if (!order) throw new NotFoundException("Lab order not found.");
    return order;
  }

  private async getOrderForPatient(id: string, caller: AuthenticatedUser) {
    if (!caller.hospitalId) throw new NotFoundException("Lab order not found.");
    const hospitalId = caller.hospitalId;
    const order = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.labOrder.findUnique({ where: { id }, include: LAB_ORDER_INCLUDE }),
    );
    if (!order) throw new NotFoundException("Lab order not found.");
    const patient = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } }),
    );
    if (!patient || order.patientId !== patient.id) throw new NotFoundException("Lab order not found.");
    return order;
  }

  private findItem(order: LabOrderWithChildren, itemId: string) {
    const item = order.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException("Lab order item not found.");
    return item;
  }

  async updateItemStatus(orderId: string, itemId: string, dto: UpdateLabOrderItemStatusDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);
    const order = await this.getOrderForStaff(orderId, caller);
    const item = this.findItem(order, itemId);

    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[caller.role]?.[item.status] ?? [];
    if (!allowedTargets.includes(dto.status)) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `Cannot transition a lab order item from ${item.status} to ${dto.status} as ${caller.role}.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.labOrderItem.update({
        where: { id: item.id },
        data: { status: dto.status },
        include: { labTest: { include: { referenceRanges: true } }, result: true },
      }),
    );
  }

  async enterResult(orderId: string, itemId: string, dto: EnterLabResultDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);
    const order = await this.getOrderForStaff(orderId, caller);
    const item = this.findItem(order, itemId);

    if (item.status !== LabOrderItemStatus.IN_PROGRESS) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `A result can only be entered once the item is IN_PROGRESS (currently ${item.status}).`,
        HttpStatus.CONFLICT,
      );
    }

    const range = selectReferenceRange(item.labTest.referenceRanges, {
      gender: order.patient.gender,
      dob: order.patient.dob,
    });
    const storedValues: StoredLabValue[] = dto.values.map((v) => ({
      parameter: v.parameter,
      value: v.value,
      unit: v.unit,
      flag: computeFlag(range, v.value),
    }));
    const isOutOfRange = storedValues.some(
      (v) => v.flag === LabResultFlag.LOW || v.flag === LabResultFlag.HIGH,
    );

    let storageKey: string | undefined;
    let uploadUrl: string | undefined;
    if (dto.reportFile) {
      validateAttachment(dto.reportFile.fileName, dto.reportFile.mimeType, dto.reportFile.sizeBytes);
      storageKey = this.s3.buildKey(hospitalId, `lab-results/${item.id}`, dto.reportFile.fileName);
      uploadUrl = await this.s3.getUploadUrl(storageKey, dto.reportFile.mimeType);
    }

    await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.$transaction([
        this.prisma.labOrderItem.update({
          where: { id: item.id },
          data: { status: LabOrderItemStatus.RESULT_UPLOADED },
        }),
        this.prisma.labResult.upsert({
          where: { labOrderItemId: item.id },
          create: {
            labOrderItemId: item.id,
            structuredValues: storedValues,
            reportFileUrl: storageKey,
            enteredBy: caller.sub,
            isOutOfRange,
          },
          update: {
            structuredValues: storedValues,
            reportFileUrl: storageKey,
            enteredBy: caller.sub,
            isOutOfRange,
            // A fresh entry always resets any prior QC decision — the state
            // machine only reaches here from IN_PROGRESS, never from an
            // already-approved/rejected item, but this keeps the row honest
            // if that precondition is ever loosened.
            approvedBy: null,
            approvedAt: null,
          },
        }),
      ]),
    );

    const result = await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.labOrderItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { labTest: { include: { referenceRanges: true } }, result: true },
      }),
    );
    return { ...result, uploadUrl };
  }

  async approveResult(orderId: string, itemId: string, dto: ApproveLabResultDto, caller: AuthenticatedUser) {
    const hospitalId = await this.requireHospitalId(caller);
    const order = await this.getOrderForStaff(orderId, caller);
    const item = this.findItem(order, itemId);

    if (item.status !== LabOrderItemStatus.RESULT_UPLOADED || !item.result) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        `Cannot approve or reject a result that isn't awaiting approval (currently ${item.status}).`,
        HttpStatus.CONFLICT,
      );
    }

    // FR-LAB-004 four-eyes: the approver must differ from the enterer.
    if (item.result.enteredBy === caller.sub) {
      throw new AppException(
        ApiErrorCode.VALIDATION_ERROR,
        "A different user must approve or reject this result than the one who entered it.",
        HttpStatus.FORBIDDEN,
      );
    }

    const targetStatus =
      dto.decision === LabResultDecision.APPROVED
        ? LabOrderItemStatus.APPROVED
        : LabOrderItemStatus.REJECTED;

    await TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.$transaction(async (tx) => {
        // Conditional on the status read above: of two concurrent decisions
        // on the same item, the second finds no RESULT_UPLOADED row and
        // fails, instead of both applying (and both notifying).
        try {
          await tx.labOrderItem.update({
            where: { id: item.id, status: LabOrderItemStatus.RESULT_UPLOADED },
            data: { status: targetStatus },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
            throw new AppException(
              ApiErrorCode.VALIDATION_ERROR,
              "This result was already approved or rejected.",
              HttpStatus.CONFLICT,
            );
          }
          throw err;
        }
        // `approvedBy`/`approvedAt` record whoever made the final QC decision
        // (approve OR reject) — the schema has no separate `rejectedBy`
        // column, and adding one for a purely descriptive rename isn't worth
        // a migration (docs/11-DECISIONS.md).
        await tx.labResult.update({
          where: { labOrderItemId: item.id },
          data: { approvedBy: caller.sub, approvedAt: new Date() },
        });
        if (dto.decision === LabResultDecision.APPROVED) {
          await this.notifyResultApproved(tx, order, item.id, item.labTest.name, hospitalId);
        }
      }),
    );
    this.notifications.publish();

    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, () =>
      this.prisma.labOrderItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { labTest: { include: { referenceRanges: true } }, result: true },
      }),
    );
  }

  /**
   * FR-LAB-005 "notification fan-out" / brief §7.5 "Patient and Doctor are
   * notified" (Email + In-app per the trigger table). Raised in the approval
   * transaction, one per approved item, and delivered after commit (D-032).
   * The email carries no test name or value (SEC-NOTIF-003).
   */
  private async notifyResultApproved(
    tx: NotificationDb,
    order: LabOrderWithChildren,
    itemId: string,
    labTestName: string,
    hospitalId: string,
  ): Promise<void> {
    await this.notifications.record(tx, {
      type: NotificationType.LAB_RESULT_APPROVED,
      hospitalId,
      recipientUserIds: [order.doctor.userId, order.patient.userId],
      title: "Lab result approved",
      body: `The result for "${labTestName}" is now approved and available to view.`,
      relatedEntityType: "LabOrder",
      relatedEntityId: order.id,
      dedupeKey: `${NotificationType.LAB_RESULT_APPROVED}:${itemId}`,
    });
  }

  /**
   * `GET /lab-orders`, a summary list per role (item status and test name,
   * never a result: results go through `GET /lab-orders/:id` and D-021):
   * - PATIENT: their own orders, newest first (FR-PORTAL-001, D-035);
   * - LAB_TECHNICIAN: the hospital's work queue, URGENT first, then oldest
   *   first (docs/04-UI-UX.md §5, Phase 13);
   * - DOCTOR: orders they placed, newest first.
   * `status` keeps orders with any item in one of the given statuses.
   */
  async findAll(query: FindLabOrdersQueryDto, caller: AuthenticatedUser) {
    if (!caller.hospitalId) return PaginatedResult.of([], 0, query.page, query.limit);
    const hospitalId = caller.hospitalId;
    return TenantContext.run({ hospitalId, userId: caller.sub, bypassTenancy: false }, async () => {
      const where: Prisma.LabOrderWhereInput = {
        hospitalId,
        ...(query.status ? { items: { some: { status: { in: query.status } } } } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.medicalRecordId ? { medicalRecordId: query.medicalRecordId } : {}),
      };
      let orderBy: Prisma.LabOrderOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "asc" }];
      if (caller.role === UserRole.PATIENT) {
        const patient = await this.prisma.patientProfile.findUnique({ where: { userId: caller.sub } });
        if (!patient) return PaginatedResult.of([], 0, query.page, query.limit);
        where.patientId = patient.id;
      } else if (caller.role === UserRole.DOCTOR) {
        const doctor = await this.prisma.doctorProfile.findUnique({ where: { userId: caller.sub } });
        if (!doctor) return PaginatedResult.of([], 0, query.page, query.limit);
        where.doctorId = doctor.id;
      } else if (caller.role === UserRole.LAB_TECHNICIAN) {
        // Enum order is ROUTINE, URGENT: descending puts URGENT first.
        orderBy = [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }];
      } else {
        return PaginatedResult.of([], 0, query.page, query.limit);
      }
      const staff = caller.role !== UserRole.PATIENT;
      const [data, total] = await Promise.all([
        this.prisma.labOrder.findMany({
          where,
          orderBy,
          skip: query.skip,
          take: query.limit,
          select: {
            id: true,
            priority: true,
            createdAt: true,
            doctor: DOCTOR_NAME_SELECT,
            ...(staff
              ? { patient: { select: { user: { select: { id: true, firstName: true, lastName: true } } } } }
              : {}),
            items: {
              orderBy: { id: "asc" },
              select: { id: true, status: true, labTest: { select: { id: true, name: true } } },
            },
          },
        }),
        this.prisma.labOrder.count({ where }),
      ]);
      const rows = data.map((row) => {
        const { patient, ...rest } = row as typeof row & { patient?: { user: { id: string; firstName: string; lastName: string } | null } };
        return staff ? { ...rest, patient: patient?.user ?? null } : rest;
      });
      return PaginatedResult.of(rows, total, query.page, query.limit);
    });
  }

  async findOne(id: string, caller: AuthenticatedUser) {
    if (!VIEW_ROLES.includes(caller.role)) throw new NotFoundException("Lab order not found.");

    const order =
      caller.role === UserRole.PATIENT
        ? await this.getOrderForPatient(id, caller)
        : await this.getOrderForStaff(id, caller);

    const items = await Promise.all(
      order.items.map(async (item) => {
        const visible = this.isResultVisible(item.status, caller.role);
        if (!visible || !item.result) {
          const { result: _result, ...rest } = item;
          return { ...rest, result: null };
        }
        // `reportFileUrl` (the raw S3 storage key) is never returned as-is —
        // SEC-FILE-003, same pre-signed-URL-only pattern as EMR attachments
        // and prescription PDFs — only a short-lived `downloadUrl` is.
        const { reportFileUrl, ...resultRest } = item.result;
        const downloadUrl = reportFileUrl ? await this.s3.getDownloadUrl(reportFileUrl) : null;
        return { ...item, result: { ...resultRest, downloadUrl } };
      }),
    );

    return { ...order, items };
  }

  /** docs/07-RBAC-MATRIX.md §3.6 "View result": LAB sees a result at any
   * stage (their own QC workflow); DOCTOR/NURSE only once it has reached a
   * terminal QC state (APPROVED or REJECTED) — seeing a rejected result is
   * operationally necessary (so they know to reorder) even though only
   * APPROVED is patient-visible; PATIENT only once truly APPROVED. */
  private isResultVisible(status: LabOrderItemStatus, role: UserRole): boolean {
    if (role === UserRole.LAB_TECHNICIAN) return true;
    if (role === UserRole.DOCTOR || role === UserRole.NURSE) {
      return status === LabOrderItemStatus.APPROVED || status === LabOrderItemStatus.REJECTED;
    }
    if (role === UserRole.PATIENT) return status === LabOrderItemStatus.APPROVED;
    return false;
  }
}
