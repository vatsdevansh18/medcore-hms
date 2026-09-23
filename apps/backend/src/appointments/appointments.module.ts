import { Module } from "@nestjs/common";
import { DoctorsModule } from "../doctors/doctors.module";
import { QueueModule } from "../queue/queue.module";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";

@Module({
  imports: [DoctorsModule, QueueModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
