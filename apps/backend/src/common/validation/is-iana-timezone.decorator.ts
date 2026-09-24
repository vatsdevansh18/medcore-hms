import { ValidateBy, type ValidationOptions } from "class-validator";

/** True if the runtime's ICU data recognises `value` as a time zone. */
export function isIanaTimezone(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects anything `Intl` can't use as a `timeZone`. `Hospital.timezone`
 * was only `@IsString()`-validated from Phase 4, which was harmless while
 * nothing read it; Phase 9's pharmacy expiry logic is its first consumer,
 * and an unrecognised zone there throws a RangeError on every date
 * computation for that hospital (docs/phase-reviews/PHASE-9-REVIEW.md).
 */
export function IsIanaTimezone(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isIanaTimezone",
      validator: {
        validate: (value) => isIanaTimezone(value),
        defaultMessage: () => "$property must be a valid IANA time zone (e.g. Asia/Kolkata)",
      },
    },
    validationOptions,
  );
}
