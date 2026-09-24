import { IsOptional, Matches } from "class-validator";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`, calendar dates in the hospital's
 * timezone (UTC for the platform view). Both optional: the default is the
 * last 7 days ending today. The service checks the order and the 92-day cap. */
export class DateRangeQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: "from must be a date in YYYY-MM-DD format" })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: "to must be a date in YYYY-MM-DD format" })
  to?: string;
}
