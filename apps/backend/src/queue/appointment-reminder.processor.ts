import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { AppointmentStatus, NotificationType } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { APPOINTMENT_REMINDER_QUEUE, type AppointmentReminderJobData } from "./queue.constants";
import { NotificationsService } from "../notifications/notifications.service";
import { doctorName, formatHospitalTime } from "../notifications/notification-format";

/** A background job has no per-request caller, so it reads across hospitals
 * via `TenantContext.bypass()` — the same documented escape hatch seed
 * scripts use, never a request handler's pattern. */
@Processor(APPOINTMENT_REMINDER_QUEUE)
export class AppointmentReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentReminderProcessor.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<AppointmentReminderJobData>): Promise<void> {
    const { appointmentId, window } = job.data;

    const appointment = await TenantContext.bypass(() =>
      this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: { include: { user: { select: SAFE_USER_SELECT } } },
          doctor: { include: { user: { select: SAFE_USER_SELECT } } },
        },
      }),
    );

    if (!appointment) {
      this.logger.warn(`Reminder job for ${appointmentId} (${window}) — appointment no longer exists, skipping.`);
      return;
    }

    // Defense in depth: jobs are actively cancelled on CANCELLED/NO_SHOW,
    // but a job already dequeued by a worker when that happens should still
    // no-op rather than remind someone about a dead appointment.
    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.NO_SHOW
    ) {
      this.logger.log(`Reminder job for ${appointmentId} (${window}) — appointment is ${appointment.status}, skipping.`);
      return;
    }

    const patientUserId = appointment.patient.user?.id;
    if (!patientUserId) {
      this.logger.warn(`Reminder job for ${appointmentId} (${window}): patient has no portal account, skipping.`);
      return;
    }

    // FR-APPT-007 / brief §7.8 "Appointment reminder": Email + SMS. The
    // appointment and window form the dedupe key, so a retried job never
    // raises a second reminder for the same window.
    const hospitalId = appointment.hospitalId;
    const hospital = await this.prisma.hospital.findUnique({ where: { id: hospitalId }, select: { timezone: true } });
    await TenantContext.run({ hospitalId, userId: null, bypassTenancy: false }, () =>
      this.notifications.record(this.prisma, {
        type: NotificationType.APPOINTMENT_REMINDER,
        hospitalId,
        recipientUserIds: [patientUserId],
        title: window === "24h" ? "Appointment tomorrow" : "Appointment in 1 hour",
        body: `Reminder: your appointment with ${doctorName(appointment.doctor.user)} is on ${formatHospitalTime(appointment.scheduledStart, hospital?.timezone ?? "Asia/Kolkata")}.`,
        relatedEntityType: "Appointment",
        relatedEntityId: appointmentId,
        dedupeKey: `${NotificationType.APPOINTMENT_REMINDER}:${appointmentId}:${window}`,
      }),
    );
    this.notifications.publish();
  }
}
