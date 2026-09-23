import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";

/** Same declare-then-pre-signed-upload shape as EMR attachments / the
 * doctor-signature upload — the caller declares the file's metadata and
 * receives a pre-signed PUT URL, never sends bytes through this endpoint. */
export class ReportFileMetaDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  sizeBytes!: number;
}
