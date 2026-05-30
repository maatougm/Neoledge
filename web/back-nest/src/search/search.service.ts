import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export interface SearchHit {
  type: 'project' | 'work_package' | 'user';
  id: string;
  title: string;
  subtitle?: string;
  projectId?: string | null;
  link: string;
}

const MAX_QUERY_LENGTH = 200;
const MAX_TAKE = 50;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, callerId: string, limit = 8): Promise<Result<SearchHit[]>> {
    const query = (q || '').trim().substring(0, MAX_QUERY_LENGTH);
    if (query.length < 2) return Result.ok([]);

    const take = Math.min(Math.max(1, limit), MAX_TAKE);

    try {
      // Resolve the set of project IDs the caller can see — Admin sees
      // everything; PMs see projects they manage; Members + Spec see
      // projects they're listed in via ProjectMember.
      const me = await this.prisma.appUser.findUnique({
        where: { id: callerId },
        select: { role: true },
      });
      let accessibleProjectIds: string[] | null = null
      if (me?.role !== 'Admin') {
        const [pmProjects, memberOf] = await Promise.all([
          this.prisma.project.findMany({
            where: { projectManagerId: callerId, isDeleted: false },
            select: { id: true },
          }),
          this.prisma.projectMember.findMany({
            where: { userId: callerId },
            select: { projectId: true },
          }),
        ])
        accessibleProjectIds = [
          ...new Set([
            ...pmProjects.map((p) => p.id),
            ...memberOf.map((m) => m.projectId),
          ]),
        ]
      }
      // For Admins, accessibleProjectIds is null → omit the `id: { in: … }`
      // filter so the search spans every project.
      const projectIdFilter = accessibleProjectIds === null
        ? {}
        : { id: { in: accessibleProjectIds } }
      const wpProjectFilter = accessibleProjectIds === null
        ? {}
        : { projectId: { in: accessibleProjectIds } }

      const [projects, wps, users] = await Promise.all([
        this.prisma.project.findMany({
          where: {
            isDeleted: false,
            ...projectIdFilter,
            OR: [{ name: { contains: query } }, { clientName: { contains: query } }],
          },
          select: { id: true, name: true, clientName: true, status: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take,
        }),
        this.prisma.workPackage.findMany({
          where: {
            isDeleted: false,
            ...wpProjectFilter,
            OR: [{ title: { contains: query } }, { description: { contains: query } }],
          },
          select: { id: true, title: true, status: true, projectId: true, type: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take,
        }),
        // User search is scoped: Admin sees everyone; everyone else only sees
        // users they share at least one project with. Closes the directory
        // enumeration where any auth'd Member could lookup any user by email.
        accessibleProjectIds === null
          ? this.prisma.appUser.findMany({
              where: {
                isActive: true,
                isDeleted: false,
                OR: [
                  { firstName: { contains: query } },
                  { lastName: { contains: query } },
                  { email: { contains: query } },
                ],
              },
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
              take: Math.min(4, take),
            })
          : this.prisma.appUser.findMany({
              where: {
                isActive: true,
                isDeleted: false,
                OR: [
                  { firstName: { contains: query } },
                  { lastName: { contains: query } },
                  { email: { contains: query } },
                ],
                AND: [
                  {
                    OR: [
                      // PM of an accessible project
                      { managedProjects: { some: { id: { in: accessibleProjectIds } } } },
                      // Member of an accessible project
                      { projectMemberships: { some: { projectId: { in: accessibleProjectIds } } } },
                    ],
                  },
                ],
              },
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
              take: Math.min(4, take),
            }),
      ]);

      const hits: SearchHit[] = [
        ...projects.map((p): SearchHit => ({
          type: 'project',
          id: p.id,
          title: p.name,
          subtitle: `${p.clientName} · ${p.status}`,
          link: `/app/pm/projects/${p.id}`,
        })),
        ...wps.map((w): SearchHit => ({
          type: 'work_package',
          id: w.id,
          title: w.title,
          subtitle: `${w.type} · ${w.status}`,
          projectId: w.projectId,
          link: `/app/pm/projects/${w.projectId}/workpackages`,
        })),
        ...users.map((u): SearchHit => ({
          type: 'user',
          id: u.id,
          title: `${u.firstName} ${u.lastName}`,
          subtitle: u.role,
          link: '',
        })),
      ];

      return Result.ok(hits);
    } catch {
      return Result.fail('Échec de la recherche.');
    }
  }
}
