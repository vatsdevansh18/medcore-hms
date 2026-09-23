import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Application-level AES-256-GCM field encryption (docs/11-DECISIONS.md
 * D-008) — used for `MedicalRecord.notesEncrypted` and
 * `MedicalRecordAddendum.noteEncrypted`. Stored layout is
 * `iv (12 bytes) || authTag (16 bytes) || ciphertext`, all in one `Bytes`
 * column, so a single value round-trips through Prisma without a second
 * column. Key rotation is a documented Phase 16 operational procedure, not
 * a live feature (D-008 consequence) — this service always decrypts with
 * the single current `ENCRYPTION_KEY`.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("ENCRYPTION_KEY"), "hex");
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]);
  }

  decrypt(stored: Buffer): string {
    const iv = stored.subarray(0, IV_LENGTH);
    const authTag = stored.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = stored.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
