import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/** `POST /appointments/emergency` — FR-APPT-006. Always `scheduledStart =
 * now`; duration comes from the doctor's own configured slot length (or a
 * 30-minute default if the doctor has no recurring availability configured
 * at all). Bypasses slot-availability checks but the DB exclusion
 * constraint still applies — a doctor already in an active appointment
 * cannot take a second one, emergency or not. */
export class CreateEmergencyAppointmentDto {
  @IsUUID()
  patientId!: string;

  @IsUUID()
  doctorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonForVisit?: string;
}
