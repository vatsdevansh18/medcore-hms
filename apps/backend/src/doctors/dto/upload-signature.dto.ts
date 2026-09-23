import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";

const MAX_SIGNATURE_SIZE_BYTES = 2 * 1024 * 1024;

/** `POST /doctors/:id/signature` — supports FR-RX-003's "doctor signature
 * overlay" on a generated prescription PDF (Phase 7). Same declare-then-
 * pre-signed-upload pattern as EMR attachments (Phase 6). */
export class UploadSignatureDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_SIGNATURE_SIZE_BYTES)
  sizeBytes!: number;
}

export { MAX_SIGNATURE_SIZE_BYTES };
