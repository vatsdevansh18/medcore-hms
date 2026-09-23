import { Module } from "@nestjs/common";
import { HospitalsController } from "./hospitals.controller";
import { HospitalsService } from "./hospitals.service";
import { DepartmentsService } from "./departments.service";

@Module({
  controllers: [HospitalsController],
  providers: [HospitalsService, DepartmentsService],
  exports: [HospitalsService, DepartmentsService],
})
export class HospitalsModule {}
