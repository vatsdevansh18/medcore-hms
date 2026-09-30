import type { Job } from "bullmq";
import { Sentry } from "./sentry";
import { SentryReportingWorkerHost } from "./sentry-worker.base";

jest.mock("@sentry/node", () => ({ captureException: jest.fn(), init: jest.fn() }));

class TestWorker extends SentryReportingWorkerHost {
  process(): Promise<void> {
    return Promise.resolve();
  }
}

function fakeJob(attemptsMade: number, attempts: number): Job {
  return {
    id: "job-1",
    queueName: "test-queue",
    data: { some: "payload" },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job;
}

describe("SentryReportingWorkerHost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports to Sentry once retries are exhausted", () => {
    const worker = new TestWorker();
    worker.onFailed(fakeJob(3, 3), new Error("boom"));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("does not report a mid-retry failure (BullMQ will retry it)", () => {
    const worker = new TestWorker();
    worker.onFailed(fakeJob(1, 3), new Error("transient"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
