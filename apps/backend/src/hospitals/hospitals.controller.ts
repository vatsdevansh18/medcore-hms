import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { UserRole } from "@medcore/types";
import { Roles, ALL_ROLES } from "../auth/decorators/roles.decorator";
import { BypassTenantScope } from "../auth/decorators/bypass-tenant-scope.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Public } from "../auth/decorators/public.decorator";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface";
import { PaginationQueryDto } from "../common/pagination/pagination-query.dto";
import { HospitalsService } from "./hospitals.service";
import { DepartmentsService } from "./departments.service";
import { CreateHospitalDto } from "./dto/create-hospital.dto";
import { UpdateHospitalDto } from "./dto/update-hospital.dto";
import { CreateDepartmentDto } from "./dto/create-department.dto";
import { UpdateDepartmentDto } from "./dto/update-department.dto";
import { UsersService } from "../users/users.service";
import { CreateHospitalAdminDto } from "../users/dto/create-hospital-admin.dto";

@Controller("hospitals")
export class HospitalsController {
  constructor(
    private readonly hospitalsService: HospitalsService,
    private readonly departmentsService: DepartmentsService,
    private readonly usersService: UsersService,
  ) {}

  @Roles(UserRole.SUPER_ADMIN)
  @BypassTenantScope()
  @Post()
  create(@Body() dto: CreateHospitalDto) {
    return this.hospitalsService.create(dto);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @BypassTenantScope()
  @Patch(":id/verify")
  @HttpCode(HttpStatus.OK)
  verify(@Param("id") id: string) {
    return this.hospitalsService.verify(id);
  }

  /** The hospital's first (or another) Hospital Admin, by a Super Admin
   * (D-042). Same pre-verified account and emailed password link as
   * `POST /users`. */
  @Roles(UserRole.SUPER_ADMIN)
  @BypassTenantScope()
  @Post(":id/admins")
  createAdmin(@Param("id") id: string, @Body() dto: CreateHospitalAdminDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.createHospitalAdmin(id, dto, user);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @BypassTenantScope()
  @Get()
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.hospitalsService.findAll(pagination);
  }

  /** Public list of hospitals accepting patient registrations (the portal's
   * sign-up form needs a hospital to register with; FR-AUTH-001). Names and
   * cities only. Declared before `:id` so "directory" isn't read as an id. */
  @Public()
  @Get("directory")
  directory() {
    return this.hospitalsService.directory();
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hospitalsService.findOne(id, user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.hospitalsService.update(id, dto, user);
  }

  @Roles(...ALL_ROLES)
  @BypassTenantScope()
  @Get(":id/departments")
  findDepartments(
    @Param("id") id: string,
    @Query() pagination: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.departmentsService.findAll(id, pagination, user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Post(":id/departments")
  createDepartment(
    @Param("id") id: string,
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.departmentsService.create(id, dto, user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Patch(":id/departments/:departmentId")
  updateDepartment(
    @Param("id") id: string,
    @Param("departmentId") departmentId: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.departmentsService.update(id, departmentId, dto, user);
  }

  @Roles(UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN)
  @BypassTenantScope()
  @Delete(":id/departments/:departmentId")
  @HttpCode(HttpStatus.OK)
  async removeDepartment(
    @Param("id") id: string,
    @Param("departmentId") departmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.departmentsService.remove(id, departmentId, user);
    return { deleted: true };
  }
}
