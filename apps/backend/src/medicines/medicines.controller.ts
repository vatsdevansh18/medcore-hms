import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import { MedicinesService } from "./medicines.service";
import { FindMedicinesQueryDto } from "./dto/find-medicines-query.dto";
import { CreateMedicineDto } from "./dto/create-medicine.dto";
import { UpdateMedicineDto } from "./dto/update-medicine.dto";
import { ReceiveBatchDto } from "./dto/receive-batch.dto";
import { FindExpiringQueryDto } from "./dto/find-expiring-query.dto";

/** docs/07-RBAC-MATRIX.md §3.7 "Search medicine inventory" row. */
const MEDICINE_READ_ROLES: UserRole[] = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.PHARMACIST,
];

/** §3.7 "Manage medicine catalog/batches": Pharmacist ✅. Hospital Admin's
 * 🟡 is read-only oversight — batch and stock-level views, no writes
 * (docs/11-DECISIONS.md D-024). */
const MEDICINE_WRITE_ROLES: UserRole[] = [UserRole.PHARMACIST];
const INVENTORY_VIEW_ROLES: UserRole[] = [UserRole.HOSPITAL_ADMIN, UserRole.PHARMACIST];

@Controller("medicines")
export class MedicinesController {
  constructor(private readonly medicinesService: MedicinesService) {}

  @Roles(...MEDICINE_READ_ROLES)
  @Get()
  findAll(@Query() query: FindMedicinesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findAll(query, user);
  }

  @Roles(...MEDICINE_WRITE_ROLES)
  @Post()
  create(@Body() dto: CreateMedicineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.create(dto, user);
  }

  // Static paths are declared before `:id` so they aren't captured by it.
  @Roles(...INVENTORY_VIEW_ROLES)
  @Get("low-stock")
  findLowStock(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findLowStock(query, user);
  }

  @Roles(...INVENTORY_VIEW_ROLES)
  @Get("expiring")
  findExpiring(@Query() query: FindExpiringQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findExpiring(query, user);
  }

  @Roles(...MEDICINE_READ_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicinesService.findOne(id, user);
  }

  @Roles(...MEDICINE_WRITE_ROLES)
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateMedicineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicinesService.update(id, dto, user);
  }

  @Roles(...INVENTORY_VIEW_ROLES)
  @Get(":id/batches")
  listBatches(
    @Param("id") id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicinesService.listBatches(id, query, user);
  }

  @Roles(...MEDICINE_WRITE_ROLES)
  @Post(":id/batches")
  receiveBatch(
    @Param("id") id: string,
    @Body() dto: ReceiveBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicinesService.receiveBatch(id, dto, user);
  }
}
