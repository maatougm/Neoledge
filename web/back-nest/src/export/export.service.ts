import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { TERMINAL_WP_STATUSES } from '../work-packages/wp-status.constants.js';

/** Structured per-project report payload — the frontend turns this into CSV/PDF. */
export interface ProjectReportData {
  project: {
    id: string;
    name: string;
    clientName: string;
    pmName: string;
    status: string;
    priority: string;
    startDate: string;
    endDate: string;
    progressPct: number;
  };
  fields: { label: string; value: string }[];
  workPackages: {
    title: string;
    status: string;
    priority: string;
    assignee: string;
    startDate: string;
    dueDate: string;
    percentDone: number;
  }[];
}

/**
 * Sanitise a value for inclusion in a CSV cell.
 *
 * - Neutralises formula-injection payloads (Excel / Google Sheets execute any
 *   cell starting with `=`, `+`, `-`, `@`, `\t` or `\r`) by prefixing a single
 *   quote.
 * - Follows RFC 4180 quoting: doubles any internal `"` and wraps the cell in
 *   `"` when it contains the field separator (`;`), a quote, or a newline.
 */
function safeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  // Prefix dangerous leading chars with a single quote to neutralise
  // Excel/Sheets formula execution on cell open.
  const needsEscape = /^[=+\-@\t\r]/.test(s);
  const escaped = needsEscape ? `'${s}` : s;
  // Double internal quotes per RFC 4180 + wrap in quotes if the cell contains
  // the `;` field separator, a quote, or a newline. Must test for `;` (not
  // `,`) because the rows below are joined with `;` — a value like
  // "ACME; Corp" would otherwise split into two columns and shift the sheet.
  if (/[";\r\n]/.test(escaped)) return `"${escaped.replace(/"/g, '""')}"`;
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

  /**
   * Structured single-project report: header/status, questionnaire fields, and
   * the project's work packages. Returned as plain JSON so the frontend can
   * render it to both CSV and PDF without a second round-trip. Excludes
   * soft-deleted WPs. Progress mirrors the list endpoints (% of WPs in a
   * terminal status).
   */
  async generateReportData(projectId: string): Promise<Result<ProjectReportData>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
        fields: { orderBy: { orderIndex: 'asc' }, select: { id: true, label: true } },
        fieldValues: { select: { projectFieldId: true, value: true } },
      },
    });
    if (!project) return Result.fail<ProjectReportData>('Projet non trouvé.');

    const workPackages = await this.prisma.workPackage.findMany({
      where: { projectId, isDeleted: false },
      select: {
        title: true,
        status: true,
        priority: true,
        percentDone: true,
        startDate: true,
        dueDate: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { title: 'asc' }],
    });

    const wpTotal = workPackages.length;
    const wpClosed = workPackages.filter((w) =>
      (TERMINAL_WP_STATUSES as readonly string[]).includes(w.status),
    ).length;
    const progressPct = wpTotal === 0 ? 0 : Math.round((wpClosed / wpTotal) * 100);

    // Map field id → value so the report keeps the PM's questionnaire order
    // (fields are already ordered by orderIndex) even when some have no value.
    const valueByField = new Map(project.fieldValues.map((v) => [v.projectFieldId, v.value]));
    const fields = project.fields.map((f) => ({
      label: f.label,
      value: valueByField.get(f.id) ?? '',
    }));

    const pmName = project.projectManager
      ? `${project.projectManager.firstName} ${project.projectManager.lastName}`.trim()
      : 'Non assigné';

    return Result.ok<ProjectReportData>({
      project: {
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        pmName,
        status: project.status,
        priority: project.priority,
        startDate: project.startDate.toISOString().slice(0, 10),
        endDate: project.endDate.toISOString().slice(0, 10),
        progressPct,
      },
      fields,
      workPackages: workPackages.map((w) => ({
        title: w.title,
        status: w.status,
        priority: w.priority,
        assignee: w.assignee ? `${w.assignee.firstName} ${w.assignee.lastName}`.trim() : '',
        startDate: w.startDate ? w.startDate.toISOString().slice(0, 10) : '',
        dueDate: w.dueDate ? w.dueDate.toISOString().slice(0, 10) : '',
        percentDone: w.percentDone,
      })),
    });
  }
}
