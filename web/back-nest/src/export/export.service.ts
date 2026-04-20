import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

/**
 * Sanitise a value for inclusion in a CSV cell.
 *
 * - Neutralises formula-injection payloads (Excel / Google Sheets execute any
 *   cell starting with `=`, `+`, `-`, `@`, `\t` or `\r`) by prefixing a single
 *   quote.
 * - Follows RFC 4180 quoting: doubles any internal `"` and wraps the cell in
 *   `"` when it contains a comma, quote, or newline.
 */
function safeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  // Prefix dangerous leading chars with a single quote to neutralise
  // Excel/Sheets formula execution on cell open.
  const needsEscape = /^[=+\-@\t\r]/.test(s);
  const escaped = needsEscape ? `'${s}` : s;
  // Double internal quotes per RFC 4180 + wrap in quotes if contains
  // comma / quote / newline.
  if (/[",\r\n]/.test(escaped)) return `"${escaped.replace(/"/g, '""')}"`;
  return escaped;
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCsv(ids?: string[]) {
    if (ids && ids.length > 10_000) {
      return Result.fail<{ content: string; contentType: string; fileName: string }>('Trop d\'identifiants (max 10 000).');
    }

    const where: { isDeleted: boolean; id?: { in: string[] } } = { isDeleted: false };
    if (ids?.length) where.id = { in: ids };

    const projects = await this.prisma.project.findMany({
      where,
      include: { projectManager: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const BOM = '\uFEFF';
    const header = 'Nom;Client;Chef de projet;Email PM;Statut;Priorité;Date début;Date fin;Créé le\n';
    const rows = projects.map((p) => {
      const pm = p.projectManager ? `${p.projectManager.firstName} ${p.projectManager.lastName}` : '';
      const pmEmail = p.projectManager?.email ?? '';
      return [
        safeCsvCell(p.name),
        safeCsvCell(p.clientName),
        safeCsvCell(pm),
        safeCsvCell(pmEmail),
        safeCsvCell(p.status),
        safeCsvCell(p.priority),
        safeCsvCell(p.startDate.toISOString().slice(0, 10)),
        safeCsvCell(p.endDate.toISOString().slice(0, 10)),
        safeCsvCell(p.createdAt.toISOString().slice(0, 10)),
      ].join(';');
    });

    return Result.ok({ content: BOM + header + rows.join('\n'), contentType: 'text/csv; charset=utf-8', fileName: `projets-export-${Date.now()}.csv` });
  }

  async exportJson(ids?: string[]) {
    if (ids && ids.length > 10_000) {
      return Result.fail<unknown[]>('Trop d\'identifiants (max 10 000).');
    }

    const where: { isDeleted: boolean; id?: { in: string[] } } = { isDeleted: false };
    if (ids?.length) where.id = { in: ids };

    const projects = await this.prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        clientName: true,
        status: true,
        priority: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        projectManager: { select: { firstName: true, lastName: true, email: true } },
        fields: { select: { id: true, label: true, fieldType: true, orderIndex: true } },
        fieldValues: {
          select: {
            id: true,
            projectFieldId: true,
            value: true,
            updatedAt: true,
            field: { select: { id: true, label: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Result.ok(projects);
  }

  async generateReport(projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true, email: true } },
        fields: { orderBy: { orderIndex: 'asc' } },
        fieldValues: { include: { field: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!project) return Result.fail<string>('Projet non trouvé.');

    const pm = project.projectManager ? `${project.projectManager.firstName} ${project.projectManager.lastName}` : 'Non assigné';
    const lines = [
      `=== RAPPORT DE PROJET ===`,
      `Nom: ${project.name}`,
      `Client: ${project.clientName}`,
      `Chef de projet: ${pm}`,
      `Statut: ${project.status}`,
      `Priorité: ${project.priority}`,
      `Date de début: ${project.startDate.toISOString().slice(0, 10)}`,
      `Date de fin: ${project.endDate.toISOString().slice(0, 10)}`,
      ``,
      `--- Champs ---`,
      ...project.fieldValues.map((v) => `${v.field?.label ?? 'Champ'}: ${v.value ?? '(vide)'}`),
      ``,
      `--- Activité récente ---`,
      ...project.activities.map((a) => `[${a.createdAt.toISOString().slice(0, 16)}] ${a.action}: ${a.detail ?? ''}`),
    ];

    return Result.ok(lines.join('\n'));
  }
}
