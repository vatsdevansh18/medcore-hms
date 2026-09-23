-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "supersedesId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_supersedesId_key" ON "Prescription"("supersedesId");

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
