import { Global, Module } from "@nestjs/common";
import { EncryptionService } from "./crypto/encryption.service";
import { S3Service } from "./storage/s3.service";
import { PdfRendererService } from "./pdf/pdf-renderer.service";

/**
 * `EncryptionService`/`S3Service` started as Phase 6's EMR-only providers,
 * but Phase 7 needs `S3Service` again for prescription PDFs and doctor
 * signature uploads — cross-cutting infra, not a Phase 6-specific concern.
 * `@Global()` here mirrors `PrismaModule`/`RedisModule`'s existing pattern
 * rather than re-declaring these providers (and paying for a second
 * `S3Client`) in every feature module that needs them.
 */
@Global()
@Module({
  providers: [EncryptionService, S3Service, PdfRendererService],
  exports: [EncryptionService, S3Service, PdfRendererService],
})
export class InfraModule {}
