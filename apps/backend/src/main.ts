import "reflect-metadata";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));

  // SEC-NET-001 — recommended security headers on every response.
  app.use(helmet());

  // Needed to read the httpOnly refresh-token cookie (FR-AUTH-002/003).
  app.use(cookieParser());

  // SEC-NET-002 — strict CORS allow-list, never a wildcard.
  app.enableCors({
    origin: config.get<string>("CORS_ORIGIN", "http://localhost:3000").split(","),
    credentials: true,
  });

  // SEC-INPUT-001 — reject any field not declared on the target DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix("api", { exclude: ["health", "health/ready"] });

  const port = config.get<number>("API_PORT", 3001);
  await app.listen(port);
}

void bootstrap();
