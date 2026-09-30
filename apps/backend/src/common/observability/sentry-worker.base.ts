import { Logger } from "@nestjs/common";
import { OnWorkerEvent, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { Sentry } from "./sentry";

/**
 * docs/03-ARCHITECTURE.md §14: Sentry must capture unhandled exceptions in
 * BullMQ workers, not just the Nest HTTP process — a gap the brief calls out
 * explicitly, since a worker throwing has no request/response cycle to
 * surface it any other way. Every processor in this codebase extends this
 * instead of `WorkerHost` directly, so the capture is automatic rather than
 * relying on each processor remembering to add it. Only the final failure
 * (retries exhausted) is reported — a mid-retry failure is expected BullMQ
 * behaviour (docs/03-ARCHITECTURE.md §12's retry policies), not a bug.
 */
export abstract class SentryReportingWorkerHost extends WorkerHost {
  private readonly sentryWorkerLogger = new Logger(SentryReportingWorkerHost.name);

  @OnWorkerEvent("failed")
  onFailed(job: Job, error: Error): void {
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted) return;

    this.sentryWorkerLogger.error(
      { err: error, queue: job.queueName, jobId: job.id, attemptsMade: job.attemptsMade },
      "BullMQ job exhausted retries",
    );
    Sentry.captureException(error, { tags: { queue: job.queueName }, extra: { jobId: job.id, jobData: job.data } });
  }
}
