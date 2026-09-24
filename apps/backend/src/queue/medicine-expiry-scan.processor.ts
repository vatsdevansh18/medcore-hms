import { Logger } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { ExpiryScanService } from "../medicines/expiry-scan.service";
import { MEDICINE_EXPIRY_SCAN_QUEUE } from "./queue.constants";

/** FR-PHARM-003/005 nightly job. All the work (and its idempotency) lives
 * in `ExpiryScanService`; this only adapts it to BullMQ. */
@Processor(MEDICINE_EXPIRY_SCAN_QUEUE)
export class MedicineExpiryScanProcessor extends WorkerHost {
  private readonly logger = new Logger(MedicineExpiryScanProcessor.name);

  constructor(private readonly expiryScan: ExpiryScanService) {
    super();
  }

  async process(job: Job): Promise<{ hospitals: number; quarantined: number }> {
    const results = await this.expiryScan.runScan(new Date());
    const quarantined = results.reduce((sum, r) => sum + r.quarantinedBatchIds.length, 0);
    this.logger.log(
      `Job ${job.id}: scanned ${results.length} hospital(s), quarantined ${quarantined} batch(es).`,
    );
    return { hospitals: results.length, quarantined };
  }
}
