import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import { MedicalRecordsService } from "./medical-records.service";
import { CreateMedicalRecordDto } from "./dto/create-medical-record.dto";
import { CreateAddendumDto } from "./dto/create-addendum.dto";
import { RecordVitalsDto } from "./dto/record-vitals.dto";
import { CreateAttachmentDto } from "./dto/create-attachment.dto";

/** docs/07-RBAC-MATRIX.md §3.4 "Read medical record" row. */
const EMR_READ_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PATIENT];

/** "Add addendum" / "Record vitals" / "Upload attachment" rows — DOCTOR and
 * NURSE only (LAB's "lab reports only" 🟡 upload access is scoped to
 * `AttachmentOwnerType.LAB_RESULT`, out of scope until Phase 8 wires up
 * lab orders — documented simplification, docs/phase-reviews/PHASE-6-REVIEW.md). */
const EMR_CLINICAL_WRITE_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE];

@Controller("medical-records")
export class MedicalRecordsController {
  constructor(private readonly medicalRecordsService: MedicalRecordsService) {}

  @Roles(UserRole.DOCTOR)
  @Post()
  create(@Body() dto: CreateMedicalRecordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalRecordsService.create(dto, user);
  }

  @Roles(...EMR_READ_ROLES)
  @Get(":patientId")
  findByPatient(
    @Param("patientId") patientId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.findByPatient(patientId, query, user);
  }

  @Roles(...EMR_READ_ROLES)
  @Get("by-appointment/:appointmentId")
  findByAppointment(@Param("appointmentId") appointmentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalRecordsService.findByAppointment(appointmentId, user);
  }

  @Roles(...EMR_READ_ROLES)
  @Get("by-id/:id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.medicalRecordsService.findOne(id, user);
  }

  @Roles(...EMR_CLINICAL_WRITE_ROLES)
  @Post(":id/addenda")
  addAddendum(
    @Param("id") id: string,
    @Body() dto: CreateAddendumDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.addAddendum(id, dto, user);
  }

  @Roles(...EMR_CLINICAL_WRITE_ROLES)
  @Post(":id/vitals")
  recordVitals(
    @Param("id") id: string,
    @Body() dto: RecordVitalsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.recordVitals(id, dto, user);
  }

  @Roles(...EMR_CLINICAL_WRITE_ROLES)
  @Post(":id/attachments")
  createAttachment(
    @Param("id") id: string,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.createAttachment(id, dto, user);
  }

  @Roles(...EMR_READ_ROLES)
  @Get(":id/attachments/:attachmentId/download-url")
  getAttachmentDownloadUrl(
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.medicalRecordsService.getAttachmentDownloadUrl(id, attachmentId, user);
  }
}
