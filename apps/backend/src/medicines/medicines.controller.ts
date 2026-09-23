import { Controller, Get, Param, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { MedicinesService } from "./medicines.service";
import { FindMedicinesQueryDto } from "./dto/find-medicines-query.dto";

/** docs/07-RBAC-MATRIX.md §3.7 "Search medicine inventory" row. */
const MEDICINE_READ_ROLES: UserRole[] = [UserRole.HOSPITAL_ADMIN, UserRole.DOCTOR, UserRole.PHARMACIST];

@Controller("medicines")
export class MedicinesController {
  constructor(private readonly medicinesService: MedicinesService) {}

  @Roles(...MEDICINE_READ_ROLES)
  @Get()
  findAll(@Query() query: FindMedicinesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findAll(query, user);
  }

  @Roles(...MEDICINE_READ_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findOne(id, user);
  }
}
