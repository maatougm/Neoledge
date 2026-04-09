import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll() {
    const templates = await this.prisma.projectTemplate.findMany({
      include: { _count: { select: { fields: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Result.ok(
      templates.map((t) => ({
        id: t.id, name: t.name, description: t.description,
        fieldCount: t._count.fields, createdAt: t.createdAt,
      })),
    );
  }

  async getById(id: string) {
    const t = await this.prisma.projectTemplate.findUnique({
      where: { id },
      include: { fields: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!t) return Result.fail<any>('Modèle non trouvé.');
    return Result.ok({
      id: t.id, name: t.name, description: t.description, createdAt: t.createdAt,
      fields: t.fields.map((f) => ({
        id: f.id, label: f.label, type: f.type, category: f.category,
        isRequired: f.isRequired, displayOrder: f.displayOrder, options: f.options,
      })),
    });
  }

  async create(dto: any, adminId: string) {
    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: (dto.fields ?? []).map((f: any, i: number) => ({
            label: f.label,
            type: f.type ?? 'Text',
            category: f.category ?? 'Custom',
            isRequired: f.isRequired ?? false,
            displayOrder: f.displayOrder ?? i,
            options: f.options ?? null,
          })),
        },
      },
      include: { fields: { orderBy: { displayOrder: 'asc' } } },
    });
    return Result.ok(template);
  }

  async deleteTemplate(id: string) {
    const t = await this.prisma.projectTemplate.findUnique({ where: { id } });
    if (!t) return Result.fail('Modèle non trouvé.');
    await this.prisma.projectTemplate.delete({ where: { id } });
    return Result.ok();
  }

  async createFromProject(projectId: string, dto: { name: string; description?: string }, adminId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: { fields: { where: { fieldCategory: { in: ['Dynamic', 'Custom'] } }, orderBy: { orderIndex: 'asc' } } },
    });
    if (!project) return Result.fail<any>('Projet non trouvé.');

    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: project.fields.map((f, i) => ({
            label: f.label,
            type: f.fieldType,
            category: f.fieldCategory,
            isRequired: f.isRequired,
            displayOrder: i,
            options: f.options,
          })),
        },
      },
      include: { fields: { orderBy: { displayOrder: 'asc' } } },
    });
    return Result.ok(template);
  }

  async applyToProject(templateId: string, projectId: string) {
    const template = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
      include: { fields: true },
    });
    if (!template) return Result.fail('Modèle non trouvé.');

    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    for (const tf of template.fields) {
      const field = await this.prisma.projectField.create({
        data: {
          projectId,
          label: tf.label,
          fieldType: tf.type,
          fieldCategory: tf.category,
          isRequired: tf.isRequired,
          orderIndex: tf.displayOrder,
          options: tf.options,
        },
      });
      await this.prisma.projectFieldValue.create({
        data: { projectId, projectFieldId: field.id, value: null },
      });
    }

    return Result.ok();
  }
}
