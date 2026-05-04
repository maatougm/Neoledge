import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CollaborationService {
  constructor(private readonly prisma: PrismaService) {}

  async saveField(
    projectId: string,
    projectFieldId: string,
    value: string,
    userId: string,
  ): Promise<void> {
    const updated = await this.prisma.projectFieldValue.updateMany({
      where: { projectId, projectFieldId },
      data: { value, updatedBy: userId },
    });

    if (updated.count === 0) {
      await this.prisma.projectFieldValue.create({
        data: {
          projectId,
          projectFieldId,
          value,
          updatedBy: userId,
        },
      });
    }
  }
}
