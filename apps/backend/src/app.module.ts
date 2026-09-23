import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { buildLoggerConfig } from "./common/logging/logger.config";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // pnpm always runs this package's scripts with cwd=apps/backend, so the
      // repo-root .env (where it actually lives) is "../../.env" from here.
      // In Docker, env vars are injected directly by docker-compose and no
      // .env file exists in the image at all — dotenv silently no-ops on a
      // missing path, so this array is safe in both contexts.
      envFilePath: [".env", "../../.env"],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildLoggerConfig(
          config.get<string>("NODE_ENV", "development"),
          config.get<string>("LOG_LEVEL", "info"),
        ),
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
