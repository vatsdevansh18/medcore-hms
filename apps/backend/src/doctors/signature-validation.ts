import { HttpStatus } from "@nestjs/common";
import { ApiErrorCode } from "@medcore/types";
import { AppException } from "../common/errors/app-exception";
import { MAX_SIGNATURE_SIZE_BYTES } from "./dto/upload-signature.dto";

const ALLOWED_SIGNATURE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx).toLowerCase();
}

/** SEC-FILE-001 — same MIME-and-extension allow-list discipline as EMR
 * attachments, narrowed to images only for a signature. */
export function validateSignatureUpload(fileName: string, mimeType: string, sizeBytes: number): void {
  if (sizeBytes <= 0 || sizeBytes > MAX_SIGNATURE_SIZE_BYTES) {
    throw new AppException(
      ApiErrorCode.VALIDATION_ERROR,
      `Signature image size must be between 1 byte and ${MAX_SIGNATURE_SIZE_BYTES / (1024 * 1024)} MB.`,
      HttpStatus.BAD_REQUEST,
    );
  }

  const allowedExtensions = ALLOWED_SIGNATURE_TYPES[mimeType.toLowerCase()];
  if (!allowedExtensions || !allowedExtensions.includes(extensionOf(fileName))) {
    throw new AppException(
      ApiErrorCode.VALIDATION_ERROR,
      "Signature image type is not allowed. Accepted types: JPEG, PNG.",
      HttpStatus.BAD_REQUEST,
    );
  }
}
