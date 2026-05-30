import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { CreateTemplateDto, CreateFromProjectDto, TemplateFieldDto } from './dto/template.dto.js';

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
        isBacklogDriver: f.isBacklogDriver, backlogHint: f.backlogHint,
      })),
    });
  }

  async create(dto: CreateTemplateDto, adminId: string) {
    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: (dto.fields ?? []).map((f: TemplateFieldDto, i: number) => ({
            label: f.label,
            type: f.type ?? 'Text',
            category: f.category ?? 'Custom',
            isRequired: f.isRequired ?? false,
            displayOrder: f.displayOrder ?? i,
            options: f.options ?? null,
            isBacklogDriver: f.isBacklogDriver ?? false,
            backlogHint: f.backlogHint ?? null,
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

  async createFromProject(projectId: string, dto: CreateFromProjectDto, adminId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
      include: { fields: { where: { fieldCategory: { in: ['Dynamic', 'Custom'] } }, orderBy: { orderIndex: 'asc' } } },
    });
    if (!project) return Result.fail<any>('Projet non trouvé.');

    // Strip private fields: label starting with '_' or category 'Private'.
    const publicFields = project.fields.filter(
      (f) => !f.label.startsWith('_') && f.fieldCategory !== 'Private',
    );

    const template = await this.prisma.projectTemplate.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        createdByAdminId: adminId,
        fields: {
          create: publicFields.map((f, i) => ({
            label: f.label,
            type: f.fieldType,
            category: f.fieldCategory,
            isRequired: f.isRequired,
            displayOrder: i,
            options: f.options,
            isBacklogDriver: f.isBacklogDriver,
            backlogHint: f.backlogHint,
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

    // Fetch existing field labels to detect duplicates.
    const existingFields = await this.prisma.projectField.findMany({
      where: { projectId },
      select: { label: true },
    });
    const existingLabels = new Set(existingFields.map((f) => f.label.toLowerCase()));

    const skipped: string[] = [];

    for (const tf of template.fields) {
      if (existingLabels.has(tf.label.toLowerCase())) {
        skipped.push(tf.label);
        continue;
      }
      const field = await this.prisma.projectField.create({
        data: {
          projectId,
          label: tf.label,
          fieldType: tf.type,
          fieldCategory: tf.category,
          isRequired: tf.isRequired,
          orderIndex: tf.displayOrder,
          options: tf.options,
          isBacklogDriver: tf.isBacklogDriver,
          backlogHint: tf.backlogHint,
        },
      });
      await this.prisma.projectFieldValue.create({
        data: { projectId, projectFieldId: field.id, value: null },
      });
      existingLabels.add(tf.label.toLowerCase());
    }

    return Result.ok({ skipped });
  }
}
