import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { AppointmentStatus } from "@medcore/types";

/** Every legal transition target — nothing ever transitions back to
 * `PENDING`, so it's deliberately excluded here (the DTO layer rejects it
 * before the state-machine check even runs). */
const TARGET_STATUSES = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
] as const;

export class UpdateAppointmentStatusDto {
  @IsIn(TARGET_STATUSES)
  status!: (typeof TARGET_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelledReason?: string;
}
