import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles, ALL_ROLES } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { UsersService } from "./users.service";
import { CreateStaffDto } from "./dto/create-staff.dto";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.HOSPITAL_ADMIN)
  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.createStaff(dto, user);
  }

  @Roles(...ALL_ROLES)
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findOne(id, user);
  }
}
