import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

// Prisma unique-constraint violation (e.g. duplicate slug on concurrent create).
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'page';
}

@Injectable()
export class WikiService {
  private readonly logger = new Logger(WikiService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPageTree(projectId: string) {
    try {
      const pages = await this.prisma.wikiPage.findMany({
        where: { projectId, isDeleted: false },
        select: { id: true, title: true, slug: true, parentId: true, updatedAt: true, version: true },
        orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
      });
      return Result.ok(pages);
    } catch {
      return Result.fail('Échec du chargement.');
    }
  }

  async getBySlug(projectId: string, slug: string) {
    try {
      const page = await this.prisma.wikiPage.findFirst({
        where: { projectId, slug, isDeleted: false },
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          parent: { select: { id: true, slug: true, title: true } },
          children: { where: { isDeleted: false }, select: { id: true, slug: true, title: true }, orderBy: { title: 'asc' } },
        },
      });
      if (!page) return Result.fail('Page introuvable.');
      return Result.ok(page);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async create(projectId: string, dto: { title: string; content: string; parentId?: string }, authorId: string) {
    try {
      if (!dto.title?.trim()) return Result.fail('Titre requis.');
      // Content is stored as raw markdown. XSS sanitisation is performed on
      // render by DOMPurify in the frontend (WikiView.vue, Sprint 6).
      let slug = slugify(dto.title);
      let i = 1;
      // Only consider non-deleted pages when deduplicating the slug — a deleted
      // page with the same slug must not block re-creation of the same title.
      while (await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } })) {
        slug = `${slugify(dto.title)}-${i++}`;
      }
      const page = await this.prisma.wikiPage.create({
        data: {
          projectId,
          title: dto.title,
          slug,
          content: dto.content ?? '',
          authorId,
          parentId: dto.parentId ?? null,
          version: 1,
        },
      });
      await this.prisma.wikiRevision.create({
        data: {
          wikiPageId: page.id,
          version: 1,
          title: page.title,
          content: page.content,
          authorId,
          comment: 'Initial version',
        },
      });
      return Result.ok(page);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === PRISMA_UNIQUE_VIOLATION) {
        // Concurrent create won the slug race — return a clear error instead
        // of a generic server failure.
        return Result.fail('Ce titre de page existe déjà dans ce projet.');
      }
      this.logger.error('create failed', e);
      return Result.fail('Échec de la création.');
    }
  }

  async update(projectId: string, slug: string, dto: { title?: string; content?: string; comment?: string }, authorId: string) {
    try {
      const existing = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!existing) return Result.fail('Page introuvable.');

      const newVersion = existing.version + 1;
      const updated = await this.prisma.wikiPage.update({
        where: { id: existing.id },
        data: {
          title: dto.title ?? existing.title,
          content: dto.content ?? existing.content,
          version: newVersion,
          authorId,
        },
      });
      await this.prisma.wikiRevision.create({
        data: {
          wikiPageId: existing.id,
          version: newVersion,
          title: updated.title,
          content: updated.content,
          authorId,
          comment: dto.comment ?? null,
        },
      });
      return Result.ok(updated);
    } catch (e) {
      this.logger.error('update failed', e);
      return Result.fail('Échec.');
    }
  }

  async softDelete(projectId: string, slug: string) {
    try {
      const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!p) return Result.fail<void>('Page introuvable.');
      await this.prisma.wikiPage.update({ where: { id: p.id }, data: { isDeleted: true } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async movePage(projectId: string, slug: string, parentId: string | null) {
    try {
      const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!p) return Result.fail('Page introuvable.');

      if (parentId !== null) {
        // Self-parent check.
        if (parentId === p.id) return Result.fail('Une page ne peut pas être son propre parent.');

        // Validate parent exists and belongs to the same project.
        const parent = await this.prisma.wikiPage.findUnique({
          where: { id: parentId },
          select: { id: true, projectId: true, isDeleted: true },
        });
        if (!parent || parent.isDeleted) return Result.fail('Page parente introuvable.');
        if (parent.projectId !== projectId) return Result.fail('Page parente hors projet.');

        // Cycle detection: walk up from the candidate parent to the root.
        // If we encounter p.id anywhere in the ancestor chain, it is a cycle.
        let cursor: string | null = parentId;
        const visited = new Set<string>();
        while (cursor !== null) {
          if (cursor === p.id) return Result.fail('Déplacement impossible: cycle détecté dans la hiérarchie.');
          if (visited.has(cursor)) break; // safety — should not happen with valid data
          visited.add(cursor);
          const ancestor = await this.prisma.wikiPage.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          });
          cursor = ancestor?.parentId ?? null;
        }
      }

      const updated = await this.prisma.wikiPage.update({ where: { id: p.id }, data: { parentId } });
      return Result.ok(updated);
    } catch (e) {
      this.logger.error('movePage failed', e);
      return Result.fail('Échec.');
    }
  }

  async listRevisions(projectId: string, slug: string) {
    try {
      const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!p) return Result.fail('Page introuvable.');
      const revs = await this.prisma.wikiRevision.findMany({
        where: { wikiPageId: p.id },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { version: 'desc' },
      });
      return Result.ok(revs);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async getRevision(projectId: string, slug: string, version: number) {
    try {
      const p = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!p) return Result.fail('Page introuvable.');
      const rev = await this.prisma.wikiRevision.findUnique({
        where: { wikiPageId_version: { wikiPageId: p.id, version } },
      });
      if (!rev) return Result.fail('Révision introuvable.');
      return Result.ok(rev);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async restoreRevision(projectId: string, slug: string, version: number, authorId: string) {
    try {
      const page = await this.prisma.wikiPage.findFirst({ where: { projectId, slug, isDeleted: false } });
      if (!page) return Result.fail('Page introuvable.');
      const rev = await this.prisma.wikiRevision.findUnique({
        where: { wikiPageId_version: { wikiPageId: page.id, version } },
      });
      if (!rev) return Result.fail('Révision introuvable.');
      return this.update(
        projectId,
        slug,
        { title: rev.title, content: rev.content, comment: `Restored from v${version}` },
        authorId,
      );
    } catch {
      return Result.fail('Échec.');
    }
  }

  async search(projectId: string, q: string) {
    try {
      const trimmed = q?.trim() ?? '';
      if (!trimmed) return Result.ok([]);
      if (trimmed.length > 200) return Result.fail('Requête trop longue (max 200 caractères).');
      const pages = await this.prisma.wikiPage.findMany({
        where: {
          projectId,
          isDeleted: false,
          OR: [{ title: { contains: trimmed } }, { content: { contains: trimmed } }],
        },
        select: { id: true, title: true, slug: true, updatedAt: true },
        take: 50,
      });
      return Result.ok(pages);
    } catch (e) {
      this.logger.error('search failed', e);
      return Result.fail('Échec.');
    }
  }
}
