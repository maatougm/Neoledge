import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Result } from '../common/result.js';
import { PmController } from './pm.controller.js';

describe('PmController', () => {
  let mockService: Record<string, jest.Mock>;
  let mockUsers: Record<string, jest.Mock>;
  let mockNotifs: Record<string, jest.Mock>;
  let mockPrisma: {
    project: { findFirst: jest.Mock; findMany: jest.Mock };
    projectMember: { findMany: jest.Mock };
    projectField: { findFirst: jest.Mock; create: jest.Mock; findMany: jest.Mock };
    projectFieldValue: { upsert: jest.Mock };
    appUser: { findMany: jest.Mock };
    workPackage: { findMany: jest.Mock; groupBy: jest.Mock };
    sprint: { findMany: jest.Mock };
  };
  let controller: PmController;
  const pm = { userId: 'pm1', role: 'ProjectManager' };
  const admin = { userId: 'admin1', role: 'Admin' };
  const member = { userId: 'm1', role: 'Member' };

  beforeEach(() => {
    mockService = {
      getByManager: jest.fn(),
      getById: jest.fn(),
      saveFieldValues: jest.fn(),
      addField: jest.fn(),
      getValidations: jest.fn(),
      getActivity: jest.fn(),
      getProjectsPaged: jest.fn(),
      submitValidation: jest.fn(),
    };
    mockUsers = {
      getAll: jest.fn(),
    };
    mockNotifs = { notify: jest.fn().mockResolvedValue(undefined) };
    mockPrisma = {
      project: { findFirst: jest.fn(), findMany: jest.fn() },
      projectMember: { findMany: jest.fn() },
      projectField: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
      projectFieldValue: { upsert: jest.fn() },
      appUser: { findMany: jest.fn() },
      workPackage: { findMany: jest.fn(), groupBy: jest.fn() },
      sprint: { findMany: jest.fn() },
    };
    controller = new PmController(
      mockService as never,
      mockUsers as never,
      mockNotifs as never,
      mockPrisma as never,
    );
  });

  it('getMyProjects forwards caller id', async () => {
    mockService.getByManager.mockResolvedValue(Result.ok([{ id: 'p1' }]));
    expect(await controller.getMyProjects(pm)).toEqual([{ id: 'p1' }]);
    expect(mockService.getByManager).toHaveBeenCalledWith('pm1');
  });

  it('getProject returns service value', async () => {
    mockService.getById.mockResolvedValue(Result.ok({ id: 'p1' }));
    expect(await controller.getProject('p1')).toEqual({ id: 'p1' });
  });

  it('getProject maps failure to NotFoundException', async () => {
    mockService.getById.mockResolvedValue(Result.fail('missing'));
    await expect(controller.getProject('p1')).rejects.toThrow(NotFoundException);
  });

  it('saveFieldValues forwards args', async () => {
    mockService.saveFieldValues.mockResolvedValue(Result.ok());
    await controller.saveFieldValues('p1', { fieldValues: [{ projectFieldId: 'f1', value: 'v' }] } as never, pm);
    expect(mockService.saveFieldValues).toHaveBeenCalledWith('p1', 'pm1', [
      { projectFieldId: 'f1', value: 'v' },
    ]);
  });

  it('saveFieldValues maps failure to BadRequestException', async () => {
    mockService.saveFieldValues.mockResolvedValue(Result.fail('locked'));
    await expect(
      controller.saveFieldValues('p1', { fieldValues: [] } as never, pm),
    ).rejects.toThrow(BadRequestException);
  });

  describe('addField (PM-only IDOR closure)', () => {
    it('throws NotFoundException when project missing', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      await expect(
        controller.addField('p1', { label: 'X' } as never, pm),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when caller is neither PM nor Admin', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'other-pm' });
      await expect(
        controller.addField('p1', { label: 'X' } as never, member),
      ).rejects.toThrow(ForbiddenException);
    });

    it('passes through when caller IS the project PM', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm1' });
      mockService.addField.mockResolvedValue(Result.ok({ id: 'f1' }));
      expect(await controller.addField('p1', { label: 'X' } as never, pm)).toEqual({ id: 'f1' });
    });

    it('passes through when caller is Admin even if not the project PM', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'other-pm' });
      mockService.addField.mockResolvedValue(Result.ok({ id: 'f1' }));
      expect(await controller.addField('p1', { label: 'X' } as never, admin)).toEqual({ id: 'f1' });
    });

    it('maps service failure to BadRequestException', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ projectManagerId: 'pm1' });
      mockService.addField.mockResolvedValue(Result.fail('duplicate'));
      await expect(
        controller.addField('p1', { label: 'X' } as never, pm),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('getValidations + getActivity return service values', async () => {
    mockService.getValidations.mockResolvedValue(Result.ok([{ id: 'v1' }]));
    mockService.getActivity.mockResolvedValue(Result.ok([{ id: 'a1' }]));
    expect(await controller.getValidations('p1')).toEqual([{ id: 'v1' }]);
    expect(await controller.getActivity('p1')).toEqual([{ id: 'a1' }]);
  });

  describe('getUsers', () => {
    it('forbids non-Admin/non-PM callers', async () => {
      await expect(controller.getUsers(member)).rejects.toThrow(ForbiddenException);
    });

    it('returns raw items by default', async () => {
      mockUsers.getAll.mockResolvedValue(Result.ok({ items: [{ id: 'u1', role: 'Member', isActive: true }] }));
      const out = await controller.getUsers(pm);
      expect(out).toEqual([{ id: 'u1', role: 'Member', isActive: true }]);
    });

    it('returns [] if service fails', async () => {
      mockUsers.getAll.mockResolvedValue(Result.fail('boom'));
      expect(await controller.getUsers(pm)).toEqual([]);
    });

    it('filters out inactive + Admin + Viewer when forMembers=true', async () => {
      mockUsers.getAll.mockResolvedValue(
        Result.ok({
          items: [
            { id: 'u1', role: 'Member', isActive: true },
            { id: 'u2', role: 'Member', isActive: false },
            { id: 'u3', role: 'Admin', isActive: true },
            { id: 'u4', role: 'Viewer', isActive: true },
            { id: 'u5', role: 'SpecificationTeam', isActive: true },
          ],
        }),
      );
      const out = await controller.getUsers(pm, 'true');
      expect((out as Array<{ id: string }>).map((u) => u.id).sort()).toEqual(['u1', 'u5']);
    });
  });

  describe('getTeamProjects', () => {
    it('Admin gets paged list of all projects', async () => {
      mockService.getProjectsPaged.mockResolvedValue(Result.ok({ items: [{ id: 'p1' }] }));
      const out = await controller.getTeamProjects(admin);
      expect(out).toEqual([{ id: 'p1' }]);
      expect(mockService.getProjectsPaged).toHaveBeenCalledWith(0, 200);
    });

    it('Admin returns [] on service failure', async () => {
      mockService.getProjectsPaged.mockResolvedValue(Result.fail('boom'));
      expect(await controller.getTeamProjects(admin)).toEqual([]);
    });

    it('non-Admin gets projects where they are PM or member', async () => {
      mockPrisma.projectMember.findMany.mockResolvedValue([{ projectId: 'p2' }]);
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p2' }, { id: 'p3' }]);
      const out = await controller.getTeamProjects(member);
      expect(out).toEqual([{ id: 'p2' }, { id: 'p3' }]);
      expect(mockPrisma.project.findMany).toHaveBeenCalled();
    });
  });

  describe('getMyMemberProjects', () => {
    it('returns empty items when no memberships', async () => {
      mockPrisma.projectMember.findMany.mockResolvedValue([]);
      expect(await controller.getMyMemberProjects(member)).toEqual({ items: [] });
    });

    it('decorates each project with active sprint + my in-progress count', async () => {
      mockPrisma.projectMember.findMany.mockResolvedValue([
        {
          project: {
            id: 'p1',
            name: 'P1',
            clientName: 'C',
            status: 'Active',
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
            isDeleted: false,
            boards: [{ sprints: [{ id: 's1', name: 'Sprint 1', status: 'Active', startDate: new Date(), endDate: new Date(), goal: '' }] }],
          },
        },
      ]);
      mockPrisma.workPackage.groupBy.mockResolvedValue([{ projectId: 'p1', _count: { _all: 3 } }]);
      const out = (await controller.getMyMemberProjects(member)) as { items: Array<{ id: string; myInProgressCount: number; activeSprint: unknown }> };
      expect(out.items).toHaveLength(1);
      expect(out.items[0].myInProgressCount).toBe(3);
      expect(out.items[0].activeSprint).toMatchObject({ id: 's1' });
    });
  });

  describe('getMyAssignedSprints', () => {
    it('returns empty items when no WPs', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      expect(await controller.getMyAssignedSprints(member)).toEqual({ items: [] });
    });

    it('aggregates WP counts per sprint with project info', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { sprintId: 's1', projectId: 'p1' },
        { sprintId: 's1', projectId: 'p1' },
        { sprintId: 's2', projectId: 'p2' },
      ]);
      mockPrisma.sprint.findMany.mockResolvedValue([
        { id: 's1', name: 'S1', goal: '', status: 'Active', startDate: new Date(), endDate: new Date(), board: { project: { id: 'p1', name: 'P1' } } },
        { id: 's2', name: 'S2', goal: '', status: 'Planning', startDate: new Date(), endDate: new Date(), board: { project: { id: 'p2', name: 'P2' } } },
      ]);
      const out = (await controller.getMyAssignedSprints(member)) as { items: Array<{ sprint: { id: string }; myTaskCount: number }> };
      const s1 = out.items.find((i) => i.sprint.id === 's1');
      const s2 = out.items.find((i) => i.sprint.id === 's2');
      expect(s1?.myTaskCount).toBe(2);
      expect(s2?.myTaskCount).toBe(1);
    });
  });

  describe('getAssignableUsers', () => {
    it('returns [] when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      expect(await controller.getAssignableUsers('p1')).toEqual([]);
    });

    it('queries for active Member-role users only (no PM, no SpecTeam)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'm1', firstName: 'M', lastName: 'X', role: 'Member' },
      ]);
      const out = await controller.getAssignableUsers('p1');
      expect(out).toHaveLength(1);
      const whereClause = mockPrisma.appUser.findMany.mock.calls[0][0].where;
      expect(whereClause.isActive).toBe(true);
      expect(whereClause.role).toBe('Member');
      expect(whereClause.OR).toBeUndefined();
    });
  });

  describe('submitValidation', () => {
    it('happy path forwards args + notifies', async () => {
      mockService.submitValidation.mockResolvedValue(
        Result.ok({ id: 'v1', phase: 'PhaseA' }),
      );
      mockPrisma.project.findFirst.mockResolvedValue({ name: 'P1', projectManagerId: 'pm1' });
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'admin1' }, { id: 'admin2' }]);

      const out = await controller.submitValidation('p1', pm, { isApproved: true, phase: 'PhaseA' } as never);
      expect(out).toEqual({ id: 'v1', phase: 'PhaseA' });
      // PM is the submitter, so notify is called only on admins.
      expect(mockNotifs.notify).toHaveBeenCalledTimes(2);
    });

    it('maps failure to BadRequestException', async () => {
      mockService.submitValidation.mockResolvedValue(Result.fail('not allowed'));
      await expect(
        controller.submitValidation('p1', pm, { isApproved: true, phase: 'X' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifies the PM when submitter is NOT the PM, in addition to admins', async () => {
      mockService.submitValidation.mockResolvedValue(
        Result.ok({ id: 'v1', phase: 'P' }),
      );
      mockPrisma.project.findFirst.mockResolvedValue({ name: 'P1', projectManagerId: 'pm-other' });
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'admin1' }]);
      await controller.submitValidation('p1', pm, { isApproved: false, phase: 'P' } as never);
      // PM + 1 admin = 2 notifies
      expect(mockNotifs.notify).toHaveBeenCalledTimes(2);
    });

    it('skips notifications entirely when project is missing/soft-deleted', async () => {
      mockService.submitValidation.mockResolvedValue(
        Result.ok({ id: 'v1', phase: 'P' }),
      );
      mockPrisma.project.findFirst.mockResolvedValue(null);
      await controller.submitValidation('p1', pm, { isApproved: true, phase: 'P' } as never);
      expect(mockNotifs.notify).not.toHaveBeenCalled();
    });
  });

  describe('responsibilities', () => {
    it('getResponsibilities loads the val + dep responsibles', async () => {
      mockPrisma.projectField.findMany.mockResolvedValue([
        { label: 'Responsable validation', values: [{ value: 'u-val' }] },
        { label: 'Responsable déploiement', values: [{ value: 'u-dep' }] },
      ]);
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'u-val', firstName: 'V', lastName: 'X' },
        { id: 'u-dep', firstName: 'D', lastName: 'X' },
      ]);
      const out = await controller.getResponsibilities('p1');
      expect(out.validationResponsibleId).toBe('u-val');
      expect(out.deploymentResponsibleId).toBe('u-dep');
      expect(out.validationResponsible?.firstName).toBe('V');
    });

    it('saveResponsibilities upserts both rows (creates field when missing)', async () => {
      mockPrisma.projectField.findFirst.mockResolvedValueOnce({ id: 'f-val' });
      mockPrisma.projectField.findFirst.mockResolvedValueOnce(null);
      mockPrisma.projectField.create.mockResolvedValue({ id: 'f-dep' });
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.appUser.findMany.mockResolvedValue([]);

      await controller.saveResponsibilities('p1', { validationResponsibleId: 'u1', deploymentResponsibleId: null });
      expect(mockPrisma.projectField.create).toHaveBeenCalled();
      expect(mockPrisma.projectFieldValue.upsert).toHaveBeenCalledTimes(2);
    });

    it('saveResponsibilities tolerates missing body fields (null defaults)', async () => {
      mockPrisma.projectField.findFirst.mockResolvedValue({ id: 'f1' });
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.appUser.findMany.mockResolvedValue([]);

      await controller.saveResponsibilities('p1', {});
      expect(mockPrisma.projectFieldValue.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
