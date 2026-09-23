import { Body, Controller, Get, Param, Post, Put, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles, ALL_ROLES } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { DoctorsService } from "./doctors.service";
import { AvailabilityService } from "./availability.service";
import { CreateDoctorDto } from "./dto/create-doctor.dto";
import { FindDoctorsQueryDto } from "./dto/find-doctors-query.dto";
import { SetAvailabilityDto } from "./dto/availability-slot.dto";
import { CreateAvailabilityExceptionDto } from "./dto/create-availability-exception.dto";
import { GetAvailabilityQueryDto } from "./dto/get-availability-query.dto";

/** docs/07-RBAC-MATRIX.md §3.3 — "View doctor availability (for booking)":
 * SUPER_ADMIN explicitly has no access (not part of any hospital's booking
 * staff); LAB/PHARM/ACCOUNTANT have no access either. */
const AVAILABILITY_READ_ROLES: UserRole[] = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.PATIENT,
];

@Controller("doctors")
export class DoctorsController {
  constructor(
    private readonly doctorsService: DoctorsService,
    private readonly availabilityService: AvailabilityService,
  ) {}

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

  @Roles(...AVAILABILITY_READ_ROLES)
  @Get(":id/availability")
  getAvailability(
    @Param("id") id: string,
    @Query() query: GetAvailabilityQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.availabilityService.computeAvailability(id, user, query.dateFrom, query.dateTo);
  }

  @Roles(UserRole.DOCTOR)
  @Put(":id/availability")
  setAvailability(
    @Param("id") id: string,
    @Body() dto: SetAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.availabilityService.setAvailability(id, dto, user);
  }

  @Roles(UserRole.DOCTOR)
  @Post(":id/availability-exceptions")
  createAvailabilityException(
    @Param("id") id: string,
    @Body() dto: CreateAvailabilityExceptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.availabilityService.createException(id, dto, user);
  }
}
