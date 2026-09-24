import { IsDateString } from "class-validator";

/** `PATCH /appointments/:id/reschedule` (FR-PORTAL-002, docs/11-DECISIONS.md
 * D-035). The new window must be an open slot for the same doctor. */
export class RescheduleAppointmentDto {
  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;
}
