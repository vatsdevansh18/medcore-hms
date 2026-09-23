import { IsDateString } from "class-validator";

export class GetAvailabilityQueryDto {
  @IsDateString()
  dateFrom!: string;

  @IsDateString()
  dateTo!: string;
}
