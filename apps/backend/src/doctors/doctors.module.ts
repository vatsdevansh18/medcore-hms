import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DoctorsController } from "./doctors.controller";
import { DoctorsService } from "./doctors.service";

@Module({
  imports: [AuthModule],
  controllers: [DoctorsController],
  providers: [DoctorsService],
  exports: [DoctorsService],
})
export class DoctorsModule {}
