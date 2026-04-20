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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
import { RolesService } from './roles.service.js';
import {
  AssignRoleDto,
  ClonePresetDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/role.dto.js';

@ApiTags('Admin — Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('role.view')
  @ApiOperation({ summary: 'List roles with their permission keys' })
  list() {
    return this.rolesService.listRoles();
  }

  @Get('permissions')
  @RequirePermission('role.view')
  @ApiOperation({ summary: 'List full permission catalog' })
  catalog() {
    return this.rolesService.listPermissionCatalog();
  }

  @Post()
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.createRole(dto);
  }

  @Patch(':id')
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Update a role (permissions / description)' })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.updateRole(id, dto);
  }

  @Delete(':id')
  @RequirePermission('role.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a non-preset role' })
  async delete(@Param('id') id: string) {
    await this.rolesService.deleteRole(id);
  }

  @Post(':id/clone')
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Clone a preset role into a new custom role' })
  clone(@Param('id') id: string, @Body() dto: ClonePresetDto) {
    return this.rolesService.clonePreset(id, dto.newName);
  }

  @Post('assignments')
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Assign a role to a user (global or per-project)' })
  assign(@Body() dto: AssignRoleDto) {
    return this.rolesService.assignRole(dto);
  }

  @Delete('assignments/:id')
  @RequirePermission('role.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a role assignment' })
  async unassign(@Param('id') id: string) {
    await this.rolesService.unassign(id);
  }

  @Get('users/:userId/assignments')
  @RequirePermission('role.view')
  @ApiOperation({ summary: 'List a user’s role assignments' })
  listUserAssignments(@Param('userId') userId: string) {
    return this.rolesService.listUserAssignments(userId);
  }
}
