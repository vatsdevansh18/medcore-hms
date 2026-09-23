import { Inject, Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { AppointmentStatus } from "@medcore/types";
import { PRISMA_CLIENT } from "../prisma/prisma.module";
import type { ExtendedPrismaClient } from "../prisma/prisma-client.factory";
import { TenantContext } from "../common/tenancy/tenant-context";
import { SAFE_USER_SELECT } from "../common/prisma/safe-user-select";
import { APPOINTMENT_REMINDER_QUEUE, type AppointmentReminderJobData } from "./queue.constants";
import { REMINDER_DELIVERY_PORT, type ReminderDeliveryPort } from "./reminder-delivery.stub";

/** A background job has no per-request caller, so it reads across hospitals
 * via `TenantContext.bypass()` — the same documented escape hatch seed
 * scripts use, never a request handler's pattern. */
@Processor(APPOINTMENT_REMINDER_QUEUE)
export class AppointmentReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentReminderProcessor.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient,
    @Inject(REMINDER_DELIVERY_PORT) private readonly delivery: ReminderDeliveryPort,
  ) {
    super();
  }

  async process(job: Job<AppointmentReminderJobData>): Promise<void> {
    const { appointmentId, window } = job.data;

    const appointment = await TenantContext.bypass(() =>
      this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { patient: { include: { user: { select: SAFE_USER_SELECT } } } },
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

    const patientEmail = appointment.patient.user?.email;
    if (!patientEmail) {
      this.logger.warn(`Reminder job for ${appointmentId} (${window}) — patient has no linked user/email, skipping.`);
      return;
    }

    await this.delivery.sendAppointmentReminder({
      appointmentId,
      patientEmail,
      scheduledStart: appointment.scheduledStart,
      window,
    });
  }
}
