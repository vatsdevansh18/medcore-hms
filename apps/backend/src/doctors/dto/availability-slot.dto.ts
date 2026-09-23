import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilitySlotDto {
  /** 0 = Sunday .. 6 = Saturday (JS `Date.getUTCDay()` convention — see
   * docs/11-DECISIONS.md for the wall-clock-as-UTC simplification this
   * assumes throughout Phase 5). */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(TIME_PATTERN, { message: "startTime must be in HH:mm 24-hour format" })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: "endTime must be in HH:mm 24-hour format" })
  endTime!: string;

  @IsInt()
  @Min(5)
  @Max(240)
  slotDurationMinutes!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** `PUT /doctors/:id/availability` replaces the doctor's entire weekly
 * schedule atomically — simpler and less error-prone than a partial-patch
 * API for a small, doctor-authored weekly grid (docs/11-DECISIONS.md). */
export class SetAvailabilityDto {
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  @ArrayMaxSize(7 * 4)
  slots!: AvailabilitySlotDto[];
}
