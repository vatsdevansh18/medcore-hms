import { Body, Controller, Param, Post } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { DispensingService } from "./dispensing.service";
import { DispenseDto } from "./dto/dispense.dto";

/** `POST /prescriptions/:id/dispense` (docs/08-API-CONTRACT.md §4.8) lives
 * in the pharmacy module, not PrescriptionsModule — it's a stock operation
 * (FR-PHARM-002/003) that happens to be addressed by prescription.
 * docs/07-RBAC-MATRIX.md §3.7 "Dispense against prescription": Pharmacist only. */
@Controller("prescriptions")
export class DispensingController {
  constructor(private readonly dispensingService: DispensingService) {}

  @Roles(UserRole.PHARMACIST)
  @Post(":id/dispense")
  dispense(
    @Param("id") id: string,
    @Body() dto: DispenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispensingService.dispense(id, dto, user);
  }
}
