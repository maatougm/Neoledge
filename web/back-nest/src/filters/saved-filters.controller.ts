import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SavedFiltersService } from './saved-filters.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateSavedFilterDto, UpdateSavedFilterDto } from './dto/saved-filter.dto.js';

@Controller('api/saved-filters')
@UseGuards(JwtAuthGuard)
export class SavedFiltersController {
  constructor(private readonly service: SavedFiltersService) {}

  @Get()
  async getAll(@CurrentUser() user: { userId: string }) {
    const result = await this.service.getAll(user.userId);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateSavedFilterDto,
  ) {
    const result = await this.service.create(user.userId, dto);
    if (result.isFailure) throw new BadRequestException(result.error);
    return result.value;
  }

  @Put(':id')
  async update(
    @CurrentUser() user: { userId: string },
    @Param('id') filterId: string,
    @Body() dto: UpdateSavedFilterDto,
  ) {
    const result = await this.service.update(user.userId, filterId, dto);
    if (result.isFailure) throw new NotFoundException(result.error);
    return result.value;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: { userId: string },
    @Param('id') filterId: string,
  ) {
    const result = await this.service.delete(user.userId, filterId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }

  @Patch(':id/default')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDefault(
    @CurrentUser() user: { userId: string },
    @Param('id') filterId: string,
  ) {
    const result = await this.service.setDefault(user.userId, filterId);
    if (result.isFailure) throw new NotFoundException(result.error);
  }
}
