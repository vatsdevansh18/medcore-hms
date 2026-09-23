import { LabResultFlag, ReferenceRangeGender } from "@medcore/types";

/** Loosely typed against Prisma's generated (real, nominally-typed) enums —
 * see CLAUDE.md "Never declare a real TypeScript enum in packages/types" for
 * why these utilities deal in plain `string`/`string | null` for gender
 * rather than importing `@medcore/types`' `Gender`/`ReferenceRangeGender`
 * union types as parameter types (comparing a Prisma enum value against an
 * `@medcore/types` as-const constant with `===`/`!==` is fine and used
 * throughout the codebase; *assigning* one type to the other is the part
 * that risks silent mismatches, so parameters here stay untyped-string). */
interface ReferenceRangeLike {
  gender: string;
  ageMin: number | null;
  ageMax: number | null;
  lowValue: unknown;
  highValue: unknown;
}

/** Whole-years age as of today — nothing in this domain needs finer granularity. */
export function calculateAgeYears(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/** Higher score = more specific match, preferred when several ranges match. */
function specificity(range: ReferenceRangeLike): number {
  let score = 0;
  if (range.gender !== ReferenceRangeGender.ANY) score += 2;
  if (range.ageMin !== null || range.ageMax !== null) score += 1;
  return score;
}

/**
 * Picks the best-matching reference range for a patient out of a LabTest's
 * ranges. A range with an age band only matches when the patient's age is
 * known (an unknown dob can never satisfy an age-bounded range — it is not
 * treated as an automatic match). Gender-specific and age-bounded ranges are
 * preferred over `ANY`/unbounded ones when both match.
 */
export function selectReferenceRange<T extends ReferenceRangeLike>(
  ranges: T[],
  patient: { gender: string | null; dob: Date | null },
): T | undefined {
  const age = patient.dob ? calculateAgeYears(patient.dob) : null;

  const candidates = ranges.filter((range) => {
    const genderMatches =
      range.gender === ReferenceRangeGender.ANY ||
      (patient.gender !== null && range.gender === patient.gender);
    if (!genderMatches) return false;

    if (range.ageMin === null && range.ageMax === null) return true;
    if (age === null) return false;
    if (range.ageMin !== null && age < range.ageMin) return false;
    if (range.ageMax !== null && age > range.ageMax) return false;
    return true;
  });

  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => specificity(b) - specificity(a))[0];
}

export function computeFlag(range: ReferenceRangeLike | undefined, value: number): LabResultFlag {
  if (!range) return LabResultFlag.NO_REFERENCE_RANGE;
  const low = Number(range.lowValue);
  const high = Number(range.highValue);
  if (value < low) return LabResultFlag.LOW;
  if (value > high) return LabResultFlag.HIGH;
  return LabResultFlag.NORMAL;
}
