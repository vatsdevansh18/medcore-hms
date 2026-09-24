import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { HospitalsController } from "./hospitals.controller";
import { HospitalsService } from "./hospitals.service";
import { DepartmentsService } from "./departments.service";

@Module({
  imports: [UsersModule],
  controllers: [HospitalsController],
  providers: [HospitalsService, DepartmentsService],
  exports: [HospitalsService, DepartmentsService],
})
export class HospitalsModule {}
