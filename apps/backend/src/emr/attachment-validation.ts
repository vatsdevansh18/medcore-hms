import { HttpStatus } from "@nestjs/common";
import { ApiErrorCode } from "@medcore/types";
import { AppException } from "../common/errors/app-exception";

/** SEC-FILE-001 — MIME type AND extension are both checked against an
 * allow-list; a claimed MIME type of `image/png` with a `.exe` filename is
 * rejected even though the MIME type alone would pass. */
const ALLOWED_ATTACHMENT_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

/** FR-EMR-006 / SEC-FILE-002 */
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx).toLowerCase();
}

export function validateAttachment(fileName: string, mimeType: string, sizeBytes: number): void {
  if (sizeBytes <= 0 || sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new AppException(
      ApiErrorCode.VALIDATION_ERROR,
      `File size must be between 1 byte and ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)} MB.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const allowedExtensions = ALLOWED_ATTACHMENT_TYPES[mimeType.toLowerCase()];
  if (!allowedExtensions || !allowedExtensions.includes(extensionOf(fileName))) {
    throw new AppException(
      ApiErrorCode.VALIDATION_ERROR,
      "File type is not allowed. Accepted types: JPEG/PNG images, PDF, DOC/DOCX.",
      HttpStatus.BAD_REQUEST,
    );
  }
}
