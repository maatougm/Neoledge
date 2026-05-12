import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Controller('admin/appuser')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    const result = await this.usersService.getAll(
      Number(skip) || 0,
      Number(take) || 20,
      search,
      role,
    );

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return result.value;
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const result = await this.usersService.getById(id);

    if (result.isFailure) {
      throw new NotFoundException(result.error);
    }

    return result.value;
  }

  @Get('by-role/:role')
  async getByRole(@Param('role') role: string) {
    const result = await this.usersService.getByRole(role);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto) {
    const result = await this.usersService.create(dto);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return result.value;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const result = await this.usersService.update(id, dto);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return result.value;
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string) {
    const result = await this.usersService.resetPassword(id);

    if (result.isFailure) {
      throw new NotFoundException(result.error);
    }

    return result.value;
  }

  @Post(':id/deactivate')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.usersService.deactivate(id, user.userId);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return { message: 'Utilisateur désactivé.' };
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    const result = await this.usersService.reactivate(id);

    if (result.isFailure) {
      throw new NotFoundException(result.error);
    }

    return { message: 'Utilisateur réactivé.' };
  }

  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.usersService.delete(id, user.userId);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return { message: 'Utilisateur supprimé.' };
  }
}
