import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DoctorsController } from "./doctors.controller";
import { DoctorsService } from "./doctors.service";
import { AvailabilityService } from "./availability.service";

@Module({
  imports: [AuthModule],
  controllers: [DoctorsController],
  providers: [DoctorsService, AvailabilityService],
  exports: [DoctorsService, AvailabilityService],
})
export class DoctorsModule {}
