import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MedicalRecordsController } from "./medical-records.controller";
import { MedicalRecordsService } from "./medical-records.service";
import { PatientClinicalController } from "./patient-clinical.controller";
import { PatientClinicalService } from "./patient-clinical.service";

@Module({
  imports: [AuthModule],
  controllers: [MedicalRecordsController, PatientClinicalController],
  providers: [MedicalRecordsService, PatientClinicalService],
})
export class EmrModule {}
