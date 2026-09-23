import { IsInt, IsString, Max, MaxLength, Min } from "class-validator";
import { MAX_ATTACHMENT_SIZE_BYTES } from "../attachment-validation";

/** `POST /medical-records/:id/attachments` — FR-EMR-006. Client declares
 * the file's metadata up front so the server can validate MIME/extension/
 * size and issue a pre-signed upload URL before any bytes move
 * (docs/03-ARCHITECTURE.md §10) — the API never receives the file body. */
export class CreateAttachmentDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_SIZE_BYTES)
  sizeBytes!: number;
}
