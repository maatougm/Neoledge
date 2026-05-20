import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

const PHASE_DEFAULTS: Record<string, string[]> = {
  Draft: [
    'Cadrage initial validé',
    'Équipe projet identifiée',
  ],
  Kickoff: [
    'Kick-off réalisé',
    'Planning de projet communiqué',
    'Interlocuteurs clients identifiés',
  ],
  CadrageTechnique: [
    'Cahier des charges rédigé',
    'Spécifications fonctionnelles validées',
    'Revue technique effectuée',
  ],
  Environnement: [
    'Accès environnements configurés',
    'Infrastructure de recette prête',
    'Comptes de service créés',
  ],
  Parametrage: [
    'Paramétrage application réalisé',
    'Données de référence chargées',
    'Validation paramétrage par équipe spéc.',
  ],
  Integration: [
    'Connecteurs d\'intégration développés',
    'Tests d\'intégration passés',
    'Recette interne effectuée',
  ],
  Recette: [
    'Plan de recette établi',
    'Tests de recette client OK',
    'PV de recette signé',
  ],
  MEP: [
    'Mise en production réalisée',
    'Tests de smoke post-déploiement OK',
    'Documentation livrée',
  ],
  Cloture: [
    'Formation utilisateurs réalisée',
    'Clôture projet validée',
    'Bilan projet transmis',
  ],
};

@Injectable()
export class ChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForProjectPhase(projectId: string, phase: string) {
    const items = await this.prisma.phaseChecklist.findMany({
      where: { projectId, phase },
      include: { checker: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { orderIndex: 'asc' },
    });

    if (items.length === 0) {
      // Guard: only seed + recurse when this phase HAS defaults — otherwise
      // seedDefaults is a no-op and we'd recurse forever (real bug surfaced
      // by the unit test suite).
      const defaults = PHASE_DEFAULTS[phase] ?? [];
      if (defaults.length === 0) return Result.ok([]);
      await this.seedDefaults(projectId, phase);
      return this.getForProjectPhase(projectId, phase);
    }

    return Result.ok(items.map((i) => this.toDto(i)));
  }

  async toggle(itemId: string, userId: string, isChecked: boolean) {
    const item = await this.prisma.phaseChecklist.findUnique({ where: { id: itemId } });
    if (!item) return Result.fail<any>('Élément non trouvé.');

    const updated = await this.prisma.phaseChecklist.update({
      where: { id: itemId },
      data: {
        isChecked,
        checkedBy: isChecked ? userId : null,
        checkedAt: isChecked ? new Date() : null,
      },
      include: { checker: { select: { id: true, firstName: true, lastName: true } } },
    });

    return Result.ok(this.toDto(updated));
  }

  async addItem(projectId: string, phase: string, label: string) {
    const max = await this.prisma.phaseChecklist.aggregate({
      where: { projectId, phase },
      _max: { orderIndex: true },
    });

    const item = await this.prisma.phaseChecklist.create({
      data: {
        projectId,
        phase,
        label,
        orderIndex: (max._max.orderIndex ?? -1) + 1,
      },
      include: { checker: { select: { id: true, firstName: true, lastName: true } } },
    });

    return Result.ok(this.toDto(item));
  }

  async deleteItem(itemId: string) {
    const item = await this.prisma.phaseChecklist.findUnique({ where: { id: itemId } });
    if (!item) return Result.fail('Élément non trouvé.');

    await this.prisma.phaseChecklist.delete({ where: { id: itemId } });
    return Result.ok();
  }

  async getProgress(projectId: string) {
    const all = await this.prisma.phaseChecklist.findMany({ where: { projectId } });
    const byPhase: Record<string, { total: number; checked: number }> = {};

    for (const item of all) {
      if (!byPhase[item.phase]) byPhase[item.phase] = { total: 0, checked: 0 };
      byPhase[item.phase].total++;
      if (item.isChecked) byPhase[item.phase].checked++;
    }

    return Result.ok(byPhase);
  }

  private async seedDefaults(projectId: string, phase: string) {
    const labels = PHASE_DEFAULTS[phase] ?? [];
    if (!labels.length) return;

    await this.prisma.phaseChecklist.createMany({
      data: labels.map((label, orderIndex) => ({ projectId, phase, label, orderIndex })),
      skipDuplicates: true,
    });
  }

  private toDto(item: any) {
    return {
      id: item.id,
      projectId: item.projectId,
      phase: item.phase,
      label: item.label,
      isChecked: item.isChecked,
      checkedBy: item.checker ? `${item.checker.firstName} ${item.checker.lastName}` : null,
      checkedAt: item.checkedAt,
      orderIndex: item.orderIndex,
      createdAt: item.createdAt,
    };
  }
}
