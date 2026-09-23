import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { QueueEvents, type Queue } from "bullmq";
import { PRESCRIPTION_PDF_QUEUE, type PrescriptionPdfJobData } from "./queue.constants";

/** FR-RX-003 — enqueues the async PDF render for a newly-created (or
 * superseding) prescription. `jobId = prescriptionId` both dedupes retries
 * of the same request and matches docs/03-ARCHITECTURE.md §12's
 * `sourceEntityId` idempotency key for this queue.
 *
 * `@nestjs/bullmq` 12.x has no `registerQueueEvents`/`InjectQueueEvents`
 * helper (unlike `InjectQueue`), so `QueueEvents` — needed only for
 * `waitForCompletion`'s test helper below — is constructed directly here,
 * from the same parsed `REDIS_URL` connection shape `queue.module.ts` uses
 * for the queue itself. */
@Injectable()
export class PrescriptionPdfQueueService implements OnApplicationShutdown {
  private readonly queueEvents: QueueEvents;

  constructor(
    @InjectQueue(PRESCRIPTION_PDF_QUEUE) private readonly queue: Queue<PrescriptionPdfJobData>,
    config: ConfigService,
  ) {
    const url = new URL(config.getOrThrow<string>("REDIS_URL"));
    this.queueEvents = new QueueEvents(PRESCRIPTION_PDF_QUEUE, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        db: url.pathname ? Number(url.pathname.slice(1) || 0) : 0,
        maxRetriesPerRequest: null,
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queueEvents.close();
  }

  async enqueue(prescriptionId: string): Promise<void> {
    await this.queue.add("render", { prescriptionId }, { jobId: prescriptionId });
  }

  /** Test-only helper — waits for the PDF job to actually finish rather
   * than asserting on mere enqueue, per the "no fake completion" testing
   * discipline (a job that fails silently should fail the test, not look
   * green because it was merely scheduled). */
  async waitForCompletion(prescriptionId: string, timeoutMs = 20_000): Promise<void> {
    const job = await this.queue.getJob(prescriptionId);
    if (!job) throw new Error(`No PDF job found for prescription ${prescriptionId}.`);
    await job.waitUntilFinished(this.queueEvents, timeoutMs);
  }
}
