import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EncryptionService } from "../common/crypto/encryption.service";
import { S3Service } from "../common/storage/s3.service";
import { MedicalRecordsController } from "./medical-records.controller";
import { MedicalRecordsService } from "./medical-records.service";
import { PatientClinicalController } from "./patient-clinical.controller";
import { PatientClinicalService } from "./patient-clinical.service";

@Module({
  imports: [AuthModule],
  controllers: [MedicalRecordsController, PatientClinicalController],
  providers: [MedicalRecordsService, PatientClinicalService, EncryptionService, S3Service],
})
export class EmrModule {}
