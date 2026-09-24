-- Phase 12: patient portal (docs/11-DECISIONS.md D-035, D-036).

-- AlterTable
ALTER TABLE "Hospital" ADD COLUMN     "patientRescheduleAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "patientRescheduleCutoffHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptUrl" TEXT;

-- A negative cutoff would make the policy meaningless.
ALTER TABLE "Hospital" ADD CONSTRAINT "Hospital_patientRescheduleCutoffHours_check"
  CHECK ("patientRescheduleCutoffHours" >= 0);
