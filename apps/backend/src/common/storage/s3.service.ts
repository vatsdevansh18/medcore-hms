import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGNED_URL_TTL_SECONDS = 300;

/**
 * docs/03-ARCHITECTURE.md §10 — the API never proxies file bytes; it issues
 * short-lived pre-signed PUT (upload) and GET (download) URLs against a
 * private bucket, after the caller has already validated MIME/extension/size
 * (docs/09-SECURITY.md SEC-FILE-*). Points at a LocalStack endpoint in
 * dev/test when `S3_ENDPOINT` is set (docs/11-DECISIONS.md D-015); unset in
 * production so the AWS SDK talks to real S3 (D-012).
 */
@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  /** Signs URLs handed to browsers. Differs from `client` only when the
   * browser reaches S3 at a different address than the API does. */
  private readonly publicSigner: S3Client;
  private readonly bucket: string;
  private readonly usingLocalEndpoint: boolean;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>("S3_ENDPOINT", "");
    this.usingLocalEndpoint = endpoint.length > 0;
    this.bucket = this.config.getOrThrow<string>("AWS_S3_BUCKET");
    this.client = this.createClient(endpoint);
    // A pre-signed URL's signature covers its host, so a URL for a browser
    // must be signed for the address the browser uses. In Docker dev the API
    // reaches LocalStack as `localstack:4566`, which a browser on the host
    // can't resolve; S3_PUBLIC_ENDPOINT (e.g. http://localhost:4566) fixes
    // that. Unset everywhere else, including production.
    const publicEndpoint = this.config.get<string>("S3_PUBLIC_ENDPOINT", "");
    this.publicSigner = publicEndpoint ? this.createClient(publicEndpoint) : this.client;
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      region: this.config.getOrThrow<string>("AWS_REGION"),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>("AWS_ACCESS_KEY_ID"),
        secretAccessKey: this.config.getOrThrow<string>("AWS_SECRET_ACCESS_KEY"),
      },
      // The SDK's newer default ("WHEN_SUPPORTED") signs a trailing
      // x-amz-checksum-crc32 into every presigned PUT URL it issues, but a
      // presigned URL's body is uploaded later by a client the SDK never
      // sees — nothing ever computes/sends that checksum, so the upload is
      // rejected outright (confirmed against LocalStack: "Value for
      // x-amz-checksum-crc32 header is invalid"; real AWS S3 has the same
      // requirement). "WHEN_REQUIRED" restores the pre-signed-URL-safe
      // default of only checksumming operations that mandate one.
      requestChecksumCalculation: "WHEN_REQUIRED",
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  /** Self-provisions the dev/test bucket against LocalStack only — a real
   * AWS bucket is provisioned by infra (Phase 16), never by app code. */
  async onModuleInit(): Promise<void> {
    if (!this.usingLocalEndpoint) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created dev bucket "${this.bucket}" on local S3 endpoint.`);
    }
  }

  /** `scope` is a `/`-joined path prefix (e.g. `medical-records/{id}`,
   * `doctors/{id}/signature`) — the caller owns what that prefix means. */
  buildKey(hospitalId: string, scope: string, fileName: string): string {
    const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `hospitals/${hospitalId}/${scope}/${randomUUID()}-${sanitized}`;
  }

  /** A pre-signed PUT for a client (browser) upload. */
  async getUploadUrl(key: string, mimeType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType });
    return getSignedUrl(this.publicSigner, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  /** A pre-signed GET for a client (browser) download. */
  async getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.publicSigner, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  /** A pre-signed GET fetched by the server itself (e.g. headless Chromium
   * loading a signature image while rendering a PDF), signed for the
   * address the API uses. Never hand this one to a client. */
  async getInternalDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: PRESIGNED_URL_TTL_SECONDS });
  }

  /** Server-side upload — for content the backend itself generates (e.g. a
   * rendered prescription PDF), as opposed to `getUploadUrl`'s pre-signed
   * URL for a client-originated file (docs/03-ARCHITECTURE.md §10 still
   * applies: the bucket stays private either way, reads are always via
   * `getDownloadUrl`). */
  async putObject(key: string, body: PutObjectCommandInput["Body"], contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
