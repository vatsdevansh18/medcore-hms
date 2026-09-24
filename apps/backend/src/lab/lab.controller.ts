import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { LabService } from "./lab.service";
import { CreateLabOrderDto } from "./dto/create-lab-order.dto";
import { UpdateLabOrderItemStatusDto } from "./dto/update-lab-order-item-status.dto";
import { EnterLabResultDto } from "./dto/enter-lab-result.dto";
import { ApproveLabResultDto } from "./dto/approve-lab-result.dto";
import { PaginationQueryDto } from "../common/pagination/pagination-query.dto";

const VIEW_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECHNICIAN, UserRole.PATIENT];
const STATUS_UPDATE_ROLES: UserRole[] = [UserRole.RECEPTIONIST, UserRole.LAB_TECHNICIAN];

@Controller("lab-orders")
export class LabController {
  constructor(private readonly labService: LabService) {}

  @Roles(UserRole.DOCTOR)
  @Post()
  create(@Body() dto: CreateLabOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.labService.create(dto, user);
  }

  /** FR-PORTAL-001: a patient's own lab orders (docs/11-DECISIONS.md D-035). */
  @Roles(UserRole.PATIENT)
  @Get()
  findMine(@Query() query: PaginationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.labService.findMine(query, user);
  }

  @Roles(...VIEW_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.labService.findOne(id, user);
  }

  @Roles(...STATUS_UPDATE_ROLES)
  @Patch(":id/items/:itemId/status")
  updateItemStatus(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateLabOrderItemStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labService.updateItemStatus(id, itemId, dto, user);
  }

  @Roles(UserRole.LAB_TECHNICIAN)
  @Patch(":id/items/:itemId/result")
  enterResult(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: EnterLabResultDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labService.enterResult(id, itemId, dto, user);
  }

  @Roles(UserRole.LAB_TECHNICIAN)
  @Patch(":id/items/:itemId/approve")
  approveResult(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: ApproveLabResultDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.labService.approveResult(id, itemId, dto, user);
  }
}
