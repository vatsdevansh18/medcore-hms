import "reflect-metadata";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./common/bootstrap/configure-app";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));

  // SEC-NET-001 — recommended security headers on every response.
  app.use(helmet());

  // SEC-NET-002 — strict CORS allow-list, never a wildcard.
  app.enableCors({
    origin: config.get<string>("CORS_ORIGIN", "http://localhost:3000").split(","),
    credentials: true,
  });

  configureApp(app);

  const port = config.get<number>("API_PORT", 3001);
  await app.listen(port);
}

void bootstrap();
