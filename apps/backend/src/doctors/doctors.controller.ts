import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles, ALL_ROLES } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { DoctorsService } from "./doctors.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { FindDoctorsQueryDto } from "./dto/find-doctors-query.dto";

@Controller("doctors")
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Roles(UserRole.HOSPITAL_ADMIN)
  @Post()
  create(@Body() dto: CreateDoctorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.doctorsService.create(dto, user);
  }

  // hospitalId is deliberately NOT accepted as a query param here — the
  // caller's own JWT hospitalId is the only scope honoured (SEC-AUTHZ-003).
  @Roles(...ALL_ROLES)
  @Get()
  findAll(@Query() query: FindDoctorsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.doctorsService.findAll(query, user, query.specialization);
  }

  @Roles(...ALL_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.doctorsService.findOne(id, user);
  }
}
