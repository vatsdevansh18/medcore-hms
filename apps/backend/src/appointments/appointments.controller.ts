import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { AppointmentsService } from "./appointments.service";
import { BookAppointmentDto } from "./dto/book-appointment.dto";
import { CreateEmergencyAppointmentDto } from "./dto/create-emergency-appointment.dto";
import { UpdateAppointmentStatusDto } from "./dto/update-appointment-status.dto";
import { FindAppointmentsQueryDto } from "./dto/find-appointments-query.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";

/** docs/07-RBAC-MATRIX.md §3.3 — "View appointment list"/"View a specific
 * appointment": SUPER_ADMIN (any, read-only), HOSPITAL_ADMIN/NURSE/
 * RECEPTIONIST (own hospital), DOCTOR (own only), PATIENT (self only).
 * LAB/PHARM/ACCOUNTANT have no appointment access at all. */
const APPOINTMENT_READ_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.PATIENT,
];

/** "Update appointment status" row — same five roles minus SUPER_ADMIN
 * (the matrix gives SA no status-update access, only SA's usual own-tenant
 * exclusion since SA has no single hospital an appointment could belong
 * to). Which *transitions* each of these roles may make is enforced inside
 * AppointmentsService.updateStatus, not here. */
const APPOINTMENT_STATUS_ROLES: UserRole[] = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.PATIENT,
];

@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Roles(UserRole.RECEPTIONIST, UserRole.PATIENT)
  @Post()
  book(@Body() dto: BookAppointmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.book(dto, user);
  }

  @Roles(UserRole.DOCTOR, UserRole.RECEPTIONIST)
  @Post("emergency")
  bookEmergency(
    @Body() dto: CreateEmergencyAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.bookEmergency(dto, user);
  }

  @Roles(...APPOINTMENT_READ_ROLES)
  @Get()
  findAll(@Query() query: FindAppointmentsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.findAll(query, user);
  }

  @Roles(...APPOINTMENT_READ_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.findOne(id, user);
  }

  /** FR-PORTAL-002, docs/11-DECISIONS.md D-035: patient self only. */
  @Roles(UserRole.PATIENT)
  @Patch(":id/reschedule")
  reschedule(
    @Param("id") id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.reschedule(id, dto, user);
  }

  @Roles(...APPOINTMENT_STATUS_ROLES)
  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateAppointmentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.updateStatus(id, dto, user);
  }
}
