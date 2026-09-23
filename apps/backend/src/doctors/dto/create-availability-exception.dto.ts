import { IsBoolean, IsDateString, IsOptional, IsString, Matches, MaxLength } from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** FR-APPT-001 — a date-specific override of the recurring weekly schedule
 * (leave, holiday, special hours). `isUnavailable: true` with no
 * start/end blocks the whole date; `isUnavailable: false` with start/end
 * replaces that date's normal hours with a custom window (documented
 * interpretation, docs/11-DECISIONS.md — the schema doesn't spell this out). */
export class CreateAvailabilityExceptionDto {
  @IsDateString()
  date!: string;

  @IsBoolean()
  isUnavailable!: boolean;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: "startTime must be in HH:mm 24-hour format" })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: "endTime must be in HH:mm 24-hour format" })
  endTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
