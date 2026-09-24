import cookieParser from "cookie-parser";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type INestApplication, ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * The request-handling configuration every bootstrapped Nest app must share:
 * the API prefix, the cookie parser (httpOnly refresh-token cookie), and —
 * critically — the global ValidationPipe that does DTO whitelist/transform
 * (SEC-INPUT-001). `main.ts` and every e2e spec that calls
 * `createNestApplication()` must both go through this function, never
 * duplicate its options inline: e2e specs that skipped `useGlobalPipes` here
 * were silently exercising requests with NO class-validator/class-transformer
 * pass at all (`page`/`limit` arriving as raw query-string ...
 * strings instead of numbers, extra fields never rejected) while looking
 * green, because a hand-rolled DTO check inside a service can still return
 * the right status code by coincidence. Found in Phase 4 — see
 * docs/phase-reviews/PHASE-4-REVIEW.md.
 */
export interface RawBodyRequest {
  rawBody?: Buffer;
}

/** Only webhook routes need the raw bytes (signature verification is
 * byte-exact over the body as sent, SEC-PAY-002). Everywhere else the
 * buffer is dropped rather than kept alive on every request. */
function captureWebhookRawBody(req: IncomingMessage & RawBodyRequest, _res: ServerResponse, buf: Buffer): void {
  if (req.url?.startsWith("/api/payments/webhook/")) {
    req.rawBody = Buffer.from(buf);
  }
}

export function configureApp(app: INestApplication): void {
  // Registered before Nest's own parsers (which are added at init). Nest
  // detects an existing `jsonParser` and skips its default, so this becomes
  // the one JSON parser, with the same defaults plus the raw-body hook.
  (app as NestExpressApplication).useBodyParser("json", { verify: captureWebhookRawBody });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix("api", { exclude: ["health", "health/ready"] });
}
