import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PatientClinicalService } from "./patient-clinical.service";
import { CreateAllergyDto } from "./dto/create-allergy.dto";
import { CreateVaccinationDto } from "./dto/create-vaccination.dto";
import { CreateFamilyHistoryDto } from "./dto/create-family-history.dto";

/** docs/07-RBAC-MATRIX.md §3.4 "Manage allergy/vaccination/family history"
 * row — DOCTOR/NURSE full manage, PATIENT view-own-only (read routes below;
 * write routes are DOCTOR/NURSE only). */
const READ_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PATIENT];
const WRITE_ROLES: UserRole[] = [UserRole.DOCTOR, UserRole.NURSE];

@Controller("patients/:patientId")
export class PatientClinicalController {
  constructor(private readonly service: PatientClinicalService) {}

  @Roles(...WRITE_ROLES)
  @Post("allergies")
  createAllergy(
    @Param("patientId") patientId: string,
    @Body() dto: CreateAllergyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createAllergy(patientId, dto, user);
  }

  @Roles(...READ_ROLES)
  @Get("allergies")
  findAllergies(@Param("patientId") patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findAllergies(patientId, user);
  }

  @Roles(...WRITE_ROLES)
  @Post("vaccinations")
  createVaccination(
    @Param("patientId") patientId: string,
    @Body() dto: CreateVaccinationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createVaccination(patientId, dto, user);
  }

  @Roles(...READ_ROLES)
  @Get("vaccinations")
  findVaccinations(@Param("patientId") patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findVaccinations(patientId, user);
  }

  @Roles(...WRITE_ROLES)
  @Post("family-history")
  createFamilyHistory(
    @Param("patientId") patientId: string,
    @Body() dto: CreateFamilyHistoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createFamilyHistory(patientId, dto, user);
  }

  @Roles(...READ_ROLES)
  @Get("family-history")
  findFamilyHistory(@Param("patientId") patientId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findFamilyHistory(patientId, user);
  }
}
