import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { CahierDesChargesService } from './cahier-des-charges.service.js'

/**
 * Authorization tests for saveFeedback. The spec team is global: any active
 * SpecificationTeam user (or an Admin) may validate any project's cahier — no
 * per-project assignment. The project's PM is always blocked (self-approval).
 */
describe('CahierDesChargesService — saveFeedback authorization', () => {
  function build(opts: {
    projectManagerId?: string | null
    reviewerRole?: string | null
    reviewerActive?: boolean
  }) {
    const prisma = {
      project: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ projectManagerId: opts.projectManagerId ?? 'pm-1', name: 'Projet X' }),
      },
      appUser: {
        findUnique: jest.fn().mockResolvedValue(
          opts.reviewerRole === null
            ? null
            : { role: opts.reviewerRole ?? 'SpecificationTeam', isActive: opts.reviewerActive ?? true },
        ),
      },
      cahierFeedback: { create: jest.fn().mockResolvedValue({ id: 'fb-1' }) },
    }
    const config = { get: jest.fn().mockReturnValue('gpt-4o-mini') }
    const notifications = { notifyEnhanced: jest.fn().mockResolvedValue(undefined) }

    const service = new CahierDesChargesService(
      prisma as never,
      config as never,
      {} as never, // zaiFallback
      {} as never, // aiUsage
      {} as never, // agentRunner
      notifications as never,
      {} as never, // embeddings
    )
    return { service, prisma }
  }

  it('blocks the project PM (self-approval) with 400 and does not persist', async () => {
    const { service, prisma } = build({ projectManagerId: 'pm-1' })
    await expect(service.saveFeedback('proj-1', 'pm-1', 'approved', 'ok')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(prisma.cahierFeedback.create).not.toHaveBeenCalled()
  })

  it('blocks a non-spec, non-admin user (e.g. a Member/developer) with 403', async () => {
    const { service, prisma } = build({ projectManagerId: 'pm-1', reviewerRole: 'Member' })
    await expect(service.saveFeedback('proj-1', 'dev-1', 'approved', 'ok')).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(prisma.cahierFeedback.create).not.toHaveBeenCalled()
  })

  it('allows any active SpecificationTeam user (global spec team, no assignment)', async () => {
    const { service, prisma } = build({ projectManagerId: 'pm-1', reviewerRole: 'SpecificationTeam' })
    await service.saveFeedback('proj-1', 'spec-1', 'approved', 'Validé')
    expect(prisma.cahierFeedback.create).toHaveBeenCalledTimes(1)
  })

  it('blocks an inactive SpecificationTeam user with 403', async () => {
    const { service, prisma } = build({
      projectManagerId: 'pm-1',
      reviewerRole: 'SpecificationTeam',
      reviewerActive: false,
    })
    await expect(service.saveFeedback('proj-1', 'spec-x', 'approved', 'ok')).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(prisma.cahierFeedback.create).not.toHaveBeenCalled()
  })

  it('allows an Admin', async () => {
    const { service, prisma } = build({ projectManagerId: 'pm-1', reviewerRole: 'Admin' })
    await service.saveFeedback('proj-1', 'admin-1', 'rejected', 'À corriger en détail')
    expect(prisma.cahierFeedback.create).toHaveBeenCalledTimes(1)
  })
})
