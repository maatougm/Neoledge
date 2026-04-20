import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ProjectAccessGuard } from '../common/guards/project-access.guard.js';
import { ALL_PERMISSION_KEYS } from '../permissions/permission-keys.js';

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isPreset: boolean;
  permissionKeys: string[];
  assignmentCount: number;
}

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly projectAccessGuard: ProjectAccessGuard,
  ) {}

  async listRoles(): Promise<RoleSummary[]> {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isPreset: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { assignments: true } },
      },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isPreset: r.isPreset,
      permissionKeys: r.permissions.map((rp) => rp.permission.key),
      assignmentCount: r._count.assignments,
    }));
  }

  async listPermissionCatalog(): Promise<
    { key: string; resource: string; description: string }[]
  > {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { key: 'asc' }],
      select: { key: true, resource: true, description: true },
    });
  }

  private assertKnownPermissionKeys(permissionKeys: string[]): void {
    const allowed = new Set<string>(ALL_PERMISSION_KEYS as readonly string[]);
    const unknown = permissionKeys.filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown permission key(s): ${unknown.join(', ')}`,
      );
    }
  }

  async createRole(input: {
    name: string;
    description?: string;
    permissionKeys: string[];
  }): Promise<RoleSummary> {
    this.assertKnownPermissionKeys(input.permissionKeys);

    const existing = await this.prisma.role.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new BadRequestException(`Role "${input.name}" already exists`);
    }
    const perms = await this.prisma.permission.findMany({
      where: { key: { in: input.permissionKeys } },
      select: { id: true, key: true },
    });

    const role = await this.prisma.role.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        isPreset: false,
        permissions: {
          create: perms.map((p) => ({ permissionId: p.id })),
        },
      },
    });
    this.permissions.invalidate();
    return this.getRoleSummary(role.id);
  }

  async updateRole(
    roleId: string,
    input: { name?: string; description?: string; permissionKeys?: string[] },
  ): Promise<RoleSummary> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    if (input.name && input.name !== role.name && role.isPreset) {
      throw new BadRequestException('Preset roles cannot be renamed');
    }

    if (input.permissionKeys && role.isPreset) {
      throw new BadRequestException(
        'Preset role permissions cannot be edited — clone the role first.',
      );
    }
    if (input.permissionKeys) {
      this.assertKnownPermissionKeys(input.permissionKeys);
    }

    // Resolve permission IDs BEFORE the write tx so the tx body is deterministic.
    const permIds = input.permissionKeys
      ? (await this.prisma.permission.findMany({
          where: { key: { in: input.permissionKeys } },
          select: { id: true },
        })).map((p) => p.id)
      : null;

    // Collect affected users BEFORE the tx — tokenVersion bump must happen in
    // the SAME transaction as the permission/role mutation to close the race
    // where a stale JWT could execute against newly-changed permissions (or
    // the new tokenVersion could reject requests that still have the old
    // permissions applied).
    const affectedUsers = input.permissionKeys
      ? await this.prisma.userRoleAssignment.findMany({
          where: { roleId },
          select: { userId: true },
          distinct: ['userId'],
        })
      : [];
    const affectedUserIds = affectedUsers.map((u) => u.userId);

    await this.prisma.$transaction([
      ...(permIds !== null
        ? [
            this.prisma.rolePermission.deleteMany({ where: { roleId } }),
            this.prisma.rolePermission.createMany({
              data: permIds.map((id) => ({ roleId, permissionId: id })),
              skipDuplicates: true,
            }),
          ]
        : []),
      this.prisma.role.update({
        where: { id: roleId },
        data: {
          name: input.name ?? undefined,
          description: input.description ?? undefined,
        },
      }),
      ...(affectedUserIds.length > 0
        ? [
            this.prisma.appUser.updateMany({
              where: { id: { in: affectedUserIds } },
              data: { tokenVersion: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    for (const userId of affectedUserIds) this.permissions.invalidate(userId);
    this.permissions.invalidate();
    return this.getRoleSummary(roleId);
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isPreset) {
      throw new BadRequestException('Preset roles cannot be deleted');
    }

    // Collect affected users BEFORE delete so we can bump their token versions
    // inside the same transaction AFTER the role delete succeeds. This avoids
    // the race where JWTs were invalidated but the role still existed.
    const affectedUsers = await this.prisma.userRoleAssignment.findMany({
      where: { roleId },
      select: { userId: true },
      distinct: ['userId'],
    });
    const affectedUserIds = affectedUsers.map((u) => u.userId);

    await this.prisma.$transaction([
      this.prisma.role.delete({ where: { id: roleId } }),
      ...(affectedUserIds.length > 0
        ? [
            this.prisma.appUser.updateMany({
              where: { id: { in: affectedUserIds } },
              data: { tokenVersion: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    for (const userId of affectedUserIds) this.permissions.invalidate(userId);
    this.permissions.invalidate();
  }

  async clonePreset(presetId: string, newName: string): Promise<RoleSummary> {
    const preset = await this.prisma.role.findUnique({
      where: { id: presetId },
      include: { permissions: true },
    });
    if (!preset) throw new NotFoundException('Preset not found');
    if (!preset.isPreset) {
      throw new BadRequestException('Source role is not a preset');
    }
    const nameClash = await this.prisma.role.findUnique({ where: { name: newName } });
    if (nameClash) {
      throw new BadRequestException(`Role "${newName}" already exists`);
    }
    const clone = await this.prisma.role.create({
      data: {
        name: newName,
        description: `Cloned from preset ${preset.name}`,
        isPreset: false,
        permissions: {
          create: preset.permissions.map((rp) => ({ permissionId: rp.permissionId })),
        },
      },
    });
    return this.getRoleSummary(clone.id);
  }

  async assignRole(input: {
    userId: string;
    roleId: string;
    projectId?: string | null;
  }): Promise<void> {
    const projectId = input.projectId ?? null;
    if (projectId !== null) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, isDeleted: true },
      });
      if (!project || project.isDeleted) {
        throw new NotFoundException('Project not found');
      }
    }
    const existing = await this.prisma.userRoleAssignment.findFirst({
      where: { userId: input.userId, roleId: input.roleId, projectId },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.$transaction([
      this.prisma.userRoleAssignment.create({
        data: { userId: input.userId, roleId: input.roleId, projectId },
      }),
      this.prisma.appUser.update({
        where: { id: input.userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
    this.permissions.invalidate(input.userId);
    this.projectAccessGuard.invalidate(input.userId);
  }

  async unassign(assignmentId: string): Promise<void> {
    const row = await this.prisma.userRoleAssignment.findUnique({
      where: { id: assignmentId },
      select: { userId: true },
    });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.prisma.$transaction([
      this.prisma.userRoleAssignment.delete({ where: { id: assignmentId } }),
      this.prisma.appUser.update({
        where: { id: row.userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
    this.permissions.invalidate(row.userId);
    this.projectAccessGuard.invalidate(row.userId);
  }

  async listUserAssignments(userId: string) {
    // TODO: scope project leak — currently exposes full project {id, name}
    // for every assignment regardless of caller's access. Should accept a
    // callerUserId parameter and filter project details the caller has no
    // access to, unless caller holds `user.manage`. Requires a controller
    // change to forward the authenticated user — deferred to a follow-up
    // sprint to keep this diff surgical.
    return this.prisma.userRoleAssignment.findMany({
      where: { userId },
      include: {
        role: { select: { id: true, name: true, isPreset: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getRoleSummary(roleId: string): Promise<RoleSummary> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { assignments: true } },
      },
    });
    if (!role) throw new NotFoundException('Role not found');
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isPreset: role.isPreset,
      permissionKeys: role.permissions.map((rp) => rp.permission.key),
      assignmentCount: role._count.assignments,
    };
  }

}
