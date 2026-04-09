import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

const STATUS_ORDER = [
  'Draft',
  'InProgress',
  'SpecificationValidation',
  'Realization',
  'DeploymentValidation',
  'Completed',
] as const;

type OrderedStatus = (typeof STATUS_ORDER)[number];

interface GatedTransition {
  from: OrderedStatus;
  to: OrderedStatus;
  requiredRole: string;
}

const GATED_TRANSITIONS: GatedTransition[] = [
  {
    from: 'SpecificationValidation',
    to: 'Realization',
    requiredRole: 'SpecificationTeam',
  },
  {
    from: 'DeploymentValidation',
    to: 'Completed',
    requiredRole: 'DeploymentTeam',
  },
];

@Injectable()
export class PhaseGateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns Result.ok() if the transition is allowed, Result.fail(reason) if blocked.
   */
  async canTransition(
    projectId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<Result<void>> {
    if (toStatus === 'Archived') {
      return Result.ok();
    }

    if (this.isBackward(fromStatus, toStatus)) {
      return Result.fail(
        `Transition refusée : impossible de revenir de "${fromStatus}" à "${toStatus}".`,
      );
    }

    const gate = GATED_TRANSITIONS.find(
      (g) => g.from === fromStatus && g.to === toStatus,
    );

    if (!gate) {
      return Result.ok();
    }

    const approved = await this.hasRequiredApprovals(
      projectId,
      fromStatus,
      gate.requiredRole,
    );

    if (!approved) {
      return Result.fail(
        `Transition refusée : au moins une approbation du rôle "${gate.requiredRole}" est requise pour passer de "${fromStatus}" à "${toStatus}".`,
      );
    }

    return Result.ok();
  }

  /**
   * Returns the valid next statuses from a given status.
   * Always includes 'Archived'. Excludes backward moves.
   */
  getValidNextStatuses(currentStatus: string): string[] {
    const currentIndex = STATUS_ORDER.indexOf(
      currentStatus as OrderedStatus,
    );

    const forward: string[] =
      currentIndex === -1
        ? []
        : (STATUS_ORDER.slice(currentIndex + 1) as string[]);

    const next = [...forward];

    if (currentStatus !== 'Archived') {
      next.push('Archived');
    }

    return next;
  }

  /**
   * Returns true if the transition moves backward in the status order.
   * Transitions to/from 'Archived' are not considered backward.
   */
  private isBackward(from: string, to: string): boolean {
    if (to === 'Archived' || from === 'Archived') {
      return false;
    }

    const fromIndex = STATUS_ORDER.indexOf(from as OrderedStatus);
    const toIndex = STATUS_ORDER.indexOf(to as OrderedStatus);

    if (fromIndex === -1 || toIndex === -1) {
      return false;
    }

    return toIndex < fromIndex;
  }

  /**
   * Returns true if there is at least one approved validation for the given
   * project+phase combination from a user with the required role.
   */
  private async hasRequiredApprovals(
    projectId: string,
    phase: string,
    requiredRole: string,
  ): Promise<boolean> {
    const count = await this.prisma.projectValidation.count({
      where: {
        projectId,
        phase,
        isApproved: true,
        validatedByRole: requiredRole,
      },
    });

    return count > 0;
  }
}
