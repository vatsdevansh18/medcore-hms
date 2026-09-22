import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { buildLoggerConfig } from "./common/logging/logger.config";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildLoggerConfig(
          config.get<string>("NODE_ENV", "development"),
          config.get<string>("LOG_LEVEL", "info"),
        ),
    }),
    HealthModule,
  ],
})
export class AppModule {}
