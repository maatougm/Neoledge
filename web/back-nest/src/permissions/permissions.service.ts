import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface CachedUserPermissions {
  global: Set<string>;
  perProject: Map<string, Set<string>>;
  tokenVersion: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly cache = new Map<string, CachedUserPermissions>();

  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<CachedUserPermissions> {
    const existing = this.cache.get(userId);
    if (existing && existing.expiresAt > Date.now()) {
      return existing;
    }

    const [user, assignments] = await Promise.all([
      this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { tokenVersion: true },
      }),
      this.prisma.userRoleAssignment.findMany({
        where: { userId },
        select: {
          projectId: true,
          role: {
            select: {
              permissions: {
                select: { permission: { select: { key: true } } },
              },
            },
          },
        },
      }),
    ]);

    const global = new Set<string>();
    const perProject = new Map<string, Set<string>>();

    for (const a of assignments) {
      const keys = a.role.permissions.map((rp) => rp.permission.key);
      if (a.projectId === null) {
        for (const k of keys) global.add(k);
      } else {
        let bucket = perProject.get(a.projectId);
        if (!bucket) {
          bucket = new Set<string>();
          perProject.set(a.projectId, bucket);
        }
        for (const k of keys) bucket.add(k);
      }
    }

    const entry: CachedUserPermissions = {
      global,
      perProject,
      tokenVersion: user?.tokenVersion ?? 0,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(userId, entry);
    return entry;
  }

  async userHasPermission(
    userId: string,
    permissionKey: string,
    projectId?: string | null,
  ): Promise<boolean> {
    const entry = await this.load(userId);
    if (entry.global.has(permissionKey)) return true;
    if (projectId) {
      const bucket = entry.perProject.get(projectId);
      if (bucket?.has(permissionKey)) return true;
    }
    return false;
  }

  async listPermissions(
    userId: string,
  ): Promise<{ global: string[]; perProject: Record<string, string[]> }> {
    const entry = await this.load(userId);
    const perProject: Record<string, string[]> = {};
    for (const [pid, set] of entry.perProject.entries()) {
      perProject[pid] = Array.from(set);
    }
    return { global: Array.from(entry.global), perProject };
  }

  invalidate(userId?: string): void {
    if (userId) {
      this.cache.delete(userId);
    } else {
      this.cache.clear();
    }
  }

  async getTokenVersion(userId: string): Promise<number> {
    const entry = await this.load(userId);
    return entry.tokenVersion;
  }
}
