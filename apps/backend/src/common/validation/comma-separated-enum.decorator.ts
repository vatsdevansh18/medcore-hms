import { applyDecorators } from "@nestjs/common";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn } from "class-validator";

/**
 * A query parameter holding one or more enum values, comma-separated
 * (`?status=FINALIZED,PARTIALLY_PAID`), parsed to an array. Work queues need
 * several statuses at once (e.g. "outstanding" invoices). A single value
 * still works, so existing `?status=X` callers are unaffected. The request
 * ValidationPipe doesn't enable implicit conversion, so the transform sees
 * the raw string.
 */
export function CommaSeparatedEnum(values: readonly string[]) {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : value,
    ),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(values.length),
    IsIn(values, { each: true }),
  );
}
