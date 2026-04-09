import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export interface FilterCriteria {
  status?: string[];
  priority?: string[];
  assignedToMe?: boolean;
  tags?: string[];
  search?: string;
  dateRange?: { from?: string; to?: string };
}

export interface SavedFilter {
  id: string;
  name: string;
  filters: FilterCriteria;
  createdAt: string;
  isDefault: boolean;
}

interface UserPreferences {
  savedFilters?: SavedFilter[];
  [key: string]: unknown;
}

@Injectable()
export class SavedFiltersService {
  constructor(private readonly prisma: PrismaService) {}

  private async readPreferences(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) return {};
    if (!user.preferences) return {};
    return JSON.parse(user.preferences) as UserPreferences;
  }

  private async writePreferences(userId: string, prefs: UserPreferences): Promise<void> {
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { preferences: JSON.stringify(prefs) },
    });
  }

  async getAll(userId: string): Promise<Result<SavedFilter[]>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');
    const prefs = await this.readPreferences(userId);
    return Result.ok(prefs.savedFilters ?? []);
  }

  async create(
    userId: string,
    dto: { name: string; filters: FilterCriteria; isDefault?: boolean },
  ): Promise<Result<SavedFilter>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const prefs = await this.readPreferences(userId);
    const existing = prefs.savedFilters ?? [];

    const newFilter: SavedFilter = {
      id: randomUUID(),
      name: dto.name.trim(),
      filters: { ...dto.filters },
      createdAt: new Date().toISOString(),
      isDefault: dto.isDefault ?? false,
    };

    const updatedList: SavedFilter[] = dto.isDefault
      ? [...existing.map((f) => ({ ...f, isDefault: false })), newFilter]
      : [...existing, newFilter];

    await this.writePreferences(userId, { ...prefs, savedFilters: updatedList });
    return Result.ok(newFilter);
  }

  async update(
    userId: string,
    filterId: string,
    dto: { name?: string; filters?: FilterCriteria; isDefault?: boolean },
  ): Promise<Result<SavedFilter>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const prefs = await this.readPreferences(userId);
    const existing = prefs.savedFilters ?? [];

    const target = existing.find((f) => f.id === filterId);
    if (!target) return Result.fail('Filtre non trouvé.');

    const updated: SavedFilter = {
      ...target,
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.filters !== undefined && { filters: { ...dto.filters } }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
    };

    const updatedList: SavedFilter[] =
      dto.isDefault === true
        ? existing.map((f) => (f.id === filterId ? updated : { ...f, isDefault: false }))
        : existing.map((f) => (f.id === filterId ? updated : f));

    await this.writePreferences(userId, { ...prefs, savedFilters: updatedList });
    return Result.ok(updated);
  }

  async delete(userId: string, filterId: string): Promise<Result<void>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const prefs = await this.readPreferences(userId);
    const existing = prefs.savedFilters ?? [];

    if (!existing.some((f) => f.id === filterId)) return Result.fail('Filtre non trouvé.');

    const updatedList: SavedFilter[] = existing.filter((f) => f.id !== filterId);
    await this.writePreferences(userId, { ...prefs, savedFilters: updatedList });
    return Result.ok();
  }

  async setDefault(userId: string, filterId: string): Promise<Result<void>> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const prefs = await this.readPreferences(userId);
    const existing = prefs.savedFilters ?? [];

    if (!existing.some((f) => f.id === filterId)) return Result.fail('Filtre non trouvé.');

    const updatedList: SavedFilter[] = existing.map((f) => ({
      ...f,
      isDefault: f.id === filterId,
    }));

    await this.writePreferences(userId, { ...prefs, savedFilters: updatedList });
    return Result.ok();
  }
}
