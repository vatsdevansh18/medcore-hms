import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  APPOINTMENT_REMINDER_QUEUE,
  reminderJobId,
  type AppointmentReminderJobData,
  type ReminderWindow,
} from "./queue.constants";

const REMINDER_WINDOWS_MS: Record<ReminderWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

/** FR-APPT-007 — schedules the 24h/1h reminder jobs for an appointment and
 * cancels them on cancellation/no-show. A delayed job past its fire time by
 * the time it's scheduled (e.g. booked with <1h notice) is simply skipped —
 * there's nothing to remind about that far in.  */
@Injectable()
export class AppointmentReminderQueueService {
  private readonly logger = new Logger(AppointmentReminderQueueService.name);

  constructor(
    @InjectQueue(APPOINTMENT_REMINDER_QUEUE) private readonly queue: Queue<AppointmentReminderJobData>,
  ) {}

  async scheduleReminders(appointmentId: string, scheduledStart: Date): Promise<void> {
    const now = Date.now();
    const windows: ReminderWindow[] = ["24h", "1h"];

    await Promise.all(
      windows.map(async (window) => {
        const fireAt = scheduledStart.getTime() - REMINDER_WINDOWS_MS[window];
        const delay = fireAt - now;
        if (delay <= 0) {
          this.logger.debug(
            `Skipping ${window} reminder for appointment ${appointmentId} — fire time already passed.`,
          );
          return;
        }
        await this.queue.add(
          window,
          { appointmentId, window },
          { jobId: reminderJobId(appointmentId, window), delay },
        );
      }),
    );
  }

  async cancelReminders(appointmentId: string): Promise<void> {
    const windows: ReminderWindow[] = ["24h", "1h"];
    await Promise.all(
      windows.map(async (window) => {
        const job = await this.queue.getJob(reminderJobId(appointmentId, window));
        if (job && !(await job.isCompleted()) && !(await job.isActive())) {
          await job.remove();
        }
      }),
    );
  }

  /** Whether a reminder job is currently scheduled for this
   * appointment/window — used by e2e tests to assert scheduling/cancellation
   * without importing `@nestjs/bullmq`'s `getQueueToken` directly (its
   * package resolves as ESM-only under ts-jest's default CJS transform). */
  async hasReminderJob(appointmentId: string, window: ReminderWindow): Promise<boolean> {
    const job = await this.queue.getJob(reminderJobId(appointmentId, window));
    return job !== undefined;
  }
}
