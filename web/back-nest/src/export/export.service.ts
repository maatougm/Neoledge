import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportCsv(ids?: string[]) {
    const where: any = { isDeleted: false };
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
      return `"${p.name}";"${p.clientName}";"${pm}";"${pmEmail}";"${p.status}";"${p.priority}";"${p.startDate.toISOString().slice(0, 10)}";"${p.endDate.toISOString().slice(0, 10)}";"${p.createdAt.toISOString().slice(0, 10)}"`;
    });

    return Result.ok({ content: BOM + header + rows.join('\n'), contentType: 'text/csv; charset=utf-8', fileName: `projets-export-${Date.now()}.csv` });
  }

  async exportJson(ids?: string[]) {
    const where: any = { isDeleted: false };
    if (ids?.length) where.id = { in: ids };

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        projectManager: { select: { firstName: true, lastName: true, email: true } },
        fields: true,
        fieldValues: { include: { field: true } },
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
