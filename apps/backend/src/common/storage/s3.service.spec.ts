import type { ConfigService } from "@nestjs/config";
import { S3Service } from "./s3.service";

function service(env: Record<string, string>): S3Service {
  const values: Record<string, string> = {
    AWS_REGION: "ap-south-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_S3_BUCKET: "bucket",
    ...env,
  };
  const config = {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
  return new S3Service(config);
}

/**
 * Regression (Phase 12): in Docker dev every pre-signed URL pointed at
 * `localstack:4566`, a name only other containers resolve, so no browser
 * could download a prescription, receipt, report, or attachment.
 */
describe("S3Service pre-signed URL hosts", () => {
  it("signs client URLs for S3_PUBLIC_ENDPOINT and server-side URLs for S3_ENDPOINT", async () => {
    const s3 = service({ S3_ENDPOINT: "http://localstack:4566", S3_PUBLIC_ENDPOINT: "http://localhost:4566" });
    const download = new URL(await s3.getDownloadUrl("hospitals/h/receipts/r.pdf"));
    const upload = new URL(await s3.getUploadUrl("hospitals/h/x.png", "image/png"));
    const internal = new URL(await s3.getInternalDownloadUrl("hospitals/h/sig.png"));
    expect(download.host).toBe("localhost:4566");
    expect(upload.host).toBe("localhost:4566");
    expect(internal.host).toBe("localstack:4566");
    expect(download.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("uses S3_ENDPOINT for everything when no public endpoint is set (native dev)", async () => {
    const s3 = service({ S3_ENDPOINT: "http://localhost:4566" });
    expect(new URL(await s3.getDownloadUrl("k")).host).toBe("localhost:4566");
    expect(new URL(await s3.getInternalDownloadUrl("k")).host).toBe("localhost:4566");
  });

  it("uses real AWS when neither is set (production)", async () => {
    const s3 = service({});
    expect(new URL(await s3.getDownloadUrl("k")).host).toMatch(/amazonaws\.com$/);
  });
});
