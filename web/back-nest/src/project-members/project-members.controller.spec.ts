import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ProjectMembersController } from './project-members.controller.js'

const ok = <T>(value: T) => ({ isSuccess: true, isFailure: false, value, error: undefined })
const fail = (error: string) => ({ isSuccess: false, isFailure: true, value: undefined, error })

describe('ProjectMembersController', () => {
  let controller: ProjectMembersController
  let mockService: { findAll: jest.Mock; add: jest.Mock; updateLabel: jest.Mock; remove: jest.Mock }
  let mockAudit: { log: jest.Mock }
  const actor = { userId: 'pm-1', role: 'ProjectManager' }

  beforeEach(() => {
    mockService = {
      findAll: jest.fn(),
      add: jest.fn(),
      updateLabel: jest.fn(),
      remove: jest.fn(),
    }
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) }
    controller = new ProjectMembersController(mockService as any, mockAudit as any)
  })

  describe('list', () => {
    it('returns service value', async () => {
      mockService.findAll.mockResolvedValue(ok([{ id: 'm-1' }]))
      expect(await controller.list('p-1')).toEqual([{ id: 'm-1' }])
    })

    it('throws 404 on failure', async () => {
      mockService.findAll.mockResolvedValue(fail('no'))
      await expect(controller.list('p-1')).rejects.toThrow(NotFoundException)
    })
  })

  describe('add', () => {
    it('writes audit log + returns row on success', async () => {
      mockService.add.mockResolvedValue(ok({ id: 'm-new' }))
      const r = await controller.add('p-1', { userId: 'u-2', label: 'Lead' } as any, actor)
      expect(r).toEqual({ id: 'm-new' })
      expect(mockAudit.log).toHaveBeenCalledWith(
        'ProjectMember',
        'm-new',
        'CREATE',
        'pm-1',
        undefined,
        { projectId: 'p-1', addedUserId: 'u-2', label: 'Lead' },
      )
    })

    it('throws Conflict when error message contains "déjà"', async () => {
      mockService.add.mockResolvedValue(fail('Utilisateur déjà membre'))
      await expect(
        controller.add('p-1', { userId: 'u-2' } as any, actor),
      ).rejects.toThrow(ConflictException)
    })

    it('throws NotFound when error message contains "introuvable"', async () => {
      mockService.add.mockResolvedValue(fail('Utilisateur introuvable'))
      await expect(
        controller.add('p-1', { userId: 'u-2' } as any, actor),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequest on generic failure', async () => {
      mockService.add.mockResolvedValue(fail('something else'))
      await expect(
        controller.add('p-1', { userId: 'u-2' } as any, actor),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequest when service returns success but no value', async () => {
      mockService.add.mockResolvedValue(ok(null))
      await expect(
        controller.add('p-1', { userId: 'u-2' } as any, actor),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('updateLabel', () => {
    it('writes audit log + returns success', async () => {
      mockService.updateLabel.mockResolvedValue(ok({ id: 'm-1' }))
      expect(
        await controller.updateLabel('p-1', 'm-1', { label: 'Dev' } as any, actor),
      ).toEqual({ success: true })
      expect(mockAudit.log).toHaveBeenCalled()
    })

    it('throws 404 on failure', async () => {
      mockService.updateLabel.mockResolvedValue(fail('no'))
      await expect(
        controller.updateLabel('p-1', 'm-1', { label: 'X' } as any, actor),
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('parses force=true and reassignTo, returns success on happy path', async () => {
      mockService.remove.mockResolvedValue(ok(undefined))
      const r = await controller.remove('p-1', 'm-1', actor, 'true', 'u-3')
      expect(mockService.remove).toHaveBeenCalledWith('m-1', {
        force: true,
        reassignTo: 'u-3',
        actorId: 'pm-1',
      })
      expect(r).toEqual({ success: true })
      expect(mockAudit.log).toHaveBeenCalled()
    })

    it('parses force=1', async () => {
      mockService.remove.mockResolvedValue(ok(undefined))
      await controller.remove('p-1', 'm-1', actor, '1', undefined)
      expect(mockService.remove).toHaveBeenCalledWith('m-1', {
        force: true,
        reassignTo: undefined,
        actorId: 'pm-1',
      })
    })

    it('throws Conflict with parsed blockers when error starts with BLOCKERS:', async () => {
      mockService.remove.mockResolvedValue(fail('BLOCKERS:{"workpackages":2}'))
      await expect(
        controller.remove('p-1', 'm-1', actor, undefined, undefined),
      ).rejects.toThrow(ConflictException)
    })

    it('tolerates non-JSON after BLOCKERS:', async () => {
      mockService.remove.mockResolvedValue(fail('BLOCKERS:not json'))
      await expect(
        controller.remove('p-1', 'm-1', actor, undefined, undefined),
      ).rejects.toThrow(ConflictException)
    })

    it('throws NotFound when error is "Membre introuvable"', async () => {
      mockService.remove.mockResolvedValue(fail('Membre introuvable'))
      await expect(
        controller.remove('p-1', 'm-1', actor, undefined, undefined),
      ).rejects.toThrow(NotFoundException)
    })

    it('throws BadRequest on generic failure', async () => {
      mockService.remove.mockResolvedValue(fail('something else'))
      await expect(
        controller.remove('p-1', 'm-1', actor, undefined, undefined),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
