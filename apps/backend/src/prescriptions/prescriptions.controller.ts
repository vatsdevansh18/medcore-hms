import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PrescriptionsService } from "./prescriptions.service";
import { CreatePrescriptionDto } from "./dto/create-prescription.dto";
import { FindPrescriptionsQueryDto } from "./dto/find-prescriptions-query.dto";

const VIEW_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.PATIENT];
const PDF_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.PATIENT];

@Controller("prescriptions")
export class PrescriptionsController {
  constructor(private readonly prescriptionsService: PrescriptionsService) {}

  @Roles(UserRole.DOCTOR)
  @Post()
  create(@Body() dto: CreatePrescriptionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptionsService.create(dto, user);
  }

  /** Patient: own (D-035). Pharmacist: the dispensing queue. Doctor: own
   * prescriptions (Phase 13, D-040). */
  @Roles(UserRole.PATIENT, UserRole.PHARMACIST, UserRole.DOCTOR)
  @Get()
  findAll(@Query() query: FindPrescriptionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptionsService.findAll(query, user);
  }

  @Roles(...VIEW_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptionsService.findOne(id, user);
  }

  @Roles(...PDF_ROLES)
  @Get(":id/pdf")
  getPdf(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.prescriptionsService.getPdfDownloadUrl(id, user);
  }
}
