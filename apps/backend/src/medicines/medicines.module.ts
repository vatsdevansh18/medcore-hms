import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MedicinesController } from "./medicines.controller";
import { MedicinesService } from "./medicines.service";

@Module({
  imports: [AuthModule],
  controllers: [MedicinesController],
  providers: [MedicinesService],
  exports: [MedicinesService],
})
export class MedicinesModule {}
