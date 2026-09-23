import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/** `POST /appointments` — FR-APPT-002. `patientId` is only meaningful (and
 * only honoured) for a RECEPTIONIST booking on behalf of a patient; a
 * PATIENT caller always books for themselves and any `patientId` they send
 * is rejected rather than silently ignored, to fail loudly on a
 * misbehaving client instead of masking it (docs/11-DECISIONS.md). */
export class BookAppointmentDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsUUID()
  doctorId!: string;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonForVisit?: string;
}
