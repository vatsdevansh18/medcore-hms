import { Controller, Get, Query } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { LabTestsService } from "./lab-tests.service";
import { FindLabTestsQueryDto } from "./dto/find-lab-tests-query.dto";

/** The lab test catalog, read-only. Doctors order from it, lab technicians
 * see units and reference ranges while entering results, and the Hospital
 * Admin reviews prices (Phase 13B, D-041). */
@Controller("lab-tests")
export class LabTestsController {
  constructor(private readonly labTests: LabTestsService) {}

  @Roles(UserRole.DOCTOR, UserRole.LAB_TECHNICIAN, UserRole.HOSPITAL_ADMIN)
  @Get()
  findAll(@Query() query: FindLabTestsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.labTests.findAll(query, user);
  }
}
