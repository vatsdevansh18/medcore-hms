import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles, ALL_ROLES } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PatientsService } from "./patients.service";
import { RegisterPatientDto } from "./dto/register-patient.dto";
import { FindPatientsQueryDto } from "./dto/find-patients-query.dto";

@Controller("patients")
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Roles(UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN)
  @Post()
  register(@Body() dto: RegisterPatientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.register(dto, user);
  }

  @Roles(...ALL_ROLES)
  @Get()
  findAll(@Query() query: FindPatientsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findAll(query, user, query.search);
  }

  @Roles(...ALL_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.patientsService.findOne(id, user);
  }
}
