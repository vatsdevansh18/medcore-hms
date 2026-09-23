import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/** `POST /medical-records` — FR-EMR-001. Ties exactly one record to exactly
 * one appointment (DB-unique on `appointmentId`); "encounter start" is
 * enforced in the service by requiring the appointment be `IN_PROGRESS`. */
export class CreateMedicalRecordDto {
  @IsUUID()
  appointmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  presentingSymptoms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosisNotes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  confirmedDiagnosisIcd10?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  treatmentPlan?: string;

  /** Encrypted at rest as `notesEncrypted` (docs/11-DECISIONS.md D-008) — never persisted as plaintext. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
