import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, active, completed, archived, overdue, thisMonth] = await Promise.all([
      this.prisma.project.count({ where: { isDeleted: false } }),
      this.prisma.project.count({ where: { isDeleted: false, status: { in: ['Draft', 'Kickoff', 'Realisation'] } } }),
      this.prisma.project.count({ where: { isDeleted: false, status: 'Completed' } }),
      this.prisma.project.count({ where: { isDeleted: false, status: 'Archived' } }),
      this.prisma.project.count({ where: { isDeleted: false, endDate: { lt: now }, status: { notIn: ['Cloture', 'Completed', 'Archived'] } } }),
      this.prisma.project.count({ where: { isDeleted: false, createdAt: { gte: startOfMonth } } }),
    ]);

    const byStatus = await this.getProjectsByStatus();
    const byPriority = await this.prisma.project.groupBy({ by: ['priority'], where: { isDeleted: false }, _count: true });
    const workloads = await this.getWorkloads();
    const recentActivities = await this.getRecentActivity(10);

    return Result.ok({
      totalProjects: total,
      activeProjects: active,
      completedProjects: completed,
      archivedProjects: archived,
      overdueProjects: overdue,
      projectsThisMonth: thisMonth,
      projectsByStatus: byStatus.value,
      projectsByPriority: Object.fromEntries(byPriority.map((g) => [g.priority, g._count])),
      projectManagerWorkloads: workloads.value,
      recentActivities: recentActivities.value,
    });
  }

  async getProjectsByStatus() {
    const groups = await this.prisma.project.groupBy({ by: ['status'], where: { isDeleted: false }, _count: true });
    return Result.ok(Object.fromEntries(groups.map((g) => [g.status, g._count])));
  }

  async getWorkloads() {
    const managers = await this.prisma.appUser.findMany({
      where: { role: 'ProjectManager', isActive: true },
      include: {
        managedProjects: { where: { isDeleted: false }, select: { status: true, endDate: true } },
      },
    });

    return Result.ok(
      managers.map((m) => ({
        managerId: m.id,
        managerName: `${m.firstName} ${m.lastName}`,
        managerEmail: m.email,
        totalProjects: m.managedProjects.length,
        inProgressProjects: m.managedProjects.filter((p) => ['Kickoff', 'Realisation'].includes(p.status)).length,
        completedProjects: m.managedProjects.filter((p) => p.status === 'Completed').length,
        overdueProjects: m.managedProjects.filter((p) => p.endDate < new Date() && !['Cloture', 'Completed', 'Archived'].includes(p.status)).length,
      })),
    );
  }

  async getRecentActivity(count = 10) {
    // Cap to [1, 500] and reject NaN/negative inputs.
    const safeCount = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 500) : 10;
    const activities = await this.prisma.projectActivity.findMany({
      include: {
        project: { select: { id: true, name: true, clientName: true } },
        user: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: safeCount,
    });

    return Result.ok(
      activities.map((a) => ({
        id: a.id,
        action: a.action,
        detail: a.detail,
        timestamp: a.createdAt,
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : null,
        userId: a.user?.id ?? null,
        userRole: a.user?.role ?? null,
        projectId: a.project?.id ?? null,
        projectName: a.project?.name ?? null,
        projectClientName: a.project?.clientName ?? null,
      })),
    );
  }

  async getActivityStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());

    const [totalToday, totalThisWeek, projectCounts] = await Promise.all([
      this.prisma.projectActivity.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.projectActivity.count({ where: { createdAt: { gte: startOfWeek } } }),
      this.prisma.projectActivity.groupBy({
        by: ['projectId'],
        _count: { _all: true },
        orderBy: { _count: { projectId: 'desc' } },
        take: 1,
      }),
    ]);

    let mostActiveProject: { id: string; name: string; count: number } | null = null;
    if (projectCounts.length > 0) {
      const topEntry = projectCounts[0];
      const project = await this.prisma.project.findUnique({
        where: { id: topEntry.projectId },
        select: { id: true, name: true },
      });
      if (project) {
        mostActiveProject = { id: project.id, name: project.name, count: topEntry._count._all };
      }
    }

    return Result.ok({ totalToday, totalThisWeek, mostActiveProject });
  }

  async getOverdueProjects() {
    const projects = await this.prisma.project.findMany({
      where: { isDeleted: false, endDate: { lt: new Date() }, status: { notIn: ['Cloture', 'Completed', 'Archived'] } },
      include: { projectManager: { select: { firstName: true, lastName: true, email: true } } },
    });
    return Result.ok({ count: projects.length, projects });
  }
}
