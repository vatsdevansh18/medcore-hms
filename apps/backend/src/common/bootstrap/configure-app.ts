import cookieParser from "cookie-parser";
import { type INestApplication, ValidationPipe } from "@nestjs/common";

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
export function configureApp(app: INestApplication): void {
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
