import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPrismaClient, type ExtendedPrismaClient } from "./prisma-client.factory";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPrismaClient(config.getOrThrow<string>("DATABASE_URL")),
    },
  ],
  exports: [PRISMA_CLIENT],
})
export class PrismaModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: ExtendedPrismaClient) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
