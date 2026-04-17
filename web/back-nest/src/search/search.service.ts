import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export interface SearchHit {
  type: 'project' | 'work_package' | 'wiki_page' | 'user';
  id: string;
  title: string;
  subtitle?: string;
  projectId?: string | null;
  link: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, limit = 8): Promise<Result<SearchHit[]>> {
    const query = (q || '').trim();
    if (query.length < 2) return Result.ok([]);

    try {
      const [projects, wps, wikis, users] = await Promise.all([
        this.prisma.project.findMany({
          where: {
            isDeleted: false,
            OR: [{ name: { contains: query } }, { clientName: { contains: query } }],
          },
          select: { id: true, name: true, clientName: true, status: true },
          take: limit,
        }),
        this.prisma.workPackage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { description: { contains: query } }],
          },
          select: { id: true, title: true, status: true, projectId: true, type: true },
          take: limit,
        }),
        this.prisma.wikiPage.findMany({
          where: {
            isDeleted: false,
            OR: [{ title: { contains: query } }, { content: { contains: query } }],
          },
          select: { id: true, title: true, slug: true, projectId: true },
          take: limit,
        }),
        this.prisma.appUser.findMany({
          where: {
            isActive: true,
            OR: [
              { firstName: { contains: query } },
              { lastName: { contains: query } },
              { email: { contains: query } },
            ],
          },
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
          take: Math.min(4, limit),
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
        ...wikis.map((p): SearchHit => ({
          type: 'wiki_page',
          id: p.id,
          title: p.title,
          subtitle: 'Wiki',
          projectId: p.projectId,
          link: `/app/pm/projects/${p.projectId}/wiki/${p.slug}`,
        })),
        ...users.map((u): SearchHit => ({
          type: 'user',
          id: u.id,
          title: `${u.firstName} ${u.lastName}`,
          subtitle: `${u.role} · ${u.email}`,
          link: '',
        })),
      ];

      return Result.ok(hits);
    } catch {
      return Result.fail('Échec de la recherche.');
    }
  }
}
