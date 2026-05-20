import { BadRequestException } from '@nestjs/common';
import { Result } from '../common/result.js';
import {
  TimeEntriesController,
  ProjectTimeEntriesController,
} from './time-tracking.controller.js';

describe('TimeEntriesController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: TimeEntriesController;
  const u = { userId: 'u1', role: 'Member' };

  beforeEach(() => {
    mockService = {
      findMyEntries: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getWeeklyGrid: jest.fn(),
      lockPeriod: jest.fn(),
    };
    controller = new TimeEntriesController(mockService as never);
  });

  it('findMy forwards filters', async () => {
    mockService.findMyEntries.mockResolvedValue(Result.ok([{ id: 'te1' }]));
    await controller.findMy(u, '2026-01-01', '2026-01-31', 'p1', 'wp1');
    expect(mockService.findMyEntries).toHaveBeenCalledWith('u1', {
      from: '2026-01-01',
      to: '2026-01-31',
      projectId: 'p1',
      workPackageId: 'wp1',
    });
  });

  it('findMy maps failure', async () => {
    mockService.findMyEntries.mockResolvedValue(Result.fail('bad'));
    await expect(controller.findMy(u)).rejects.toThrow(BadRequestException);
  });

  it('create forwards userId+dto', async () => {
    mockService.create.mockResolvedValue(Result.ok({ id: 'te1' }));
    await controller.create(u, { workPackageId: 'wp1', minutes: 30 } as never);
    expect(mockService.create).toHaveBeenCalledWith('u1', { workPackageId: 'wp1', minutes: 30 });
  });

  it('create maps failure', async () => {
    mockService.create.mockResolvedValue(Result.fail('locked period'));
    await expect(controller.create(u, {} as never)).rejects.toThrow(BadRequestException);
  });

  it('update forwards id+user+dto', async () => {
    mockService.update.mockResolvedValue(Result.ok({ id: 'te1', minutes: 60 }));
    await controller.update('te1', u, { minutes: 60 } as never);
    expect(mockService.update).toHaveBeenCalledWith('te1', 'u1', { minutes: 60 });
  });

  it('update maps failure', async () => {
    mockService.update.mockResolvedValue(Result.fail('locked'));
    await expect(controller.update('te1', u, {} as never)).rejects.toThrow(BadRequestException);
  });

  it('remove forwards args', async () => {
    mockService.delete.mockResolvedValue(Result.ok());
    await controller.remove('te1', u);
    expect(mockService.delete).toHaveBeenCalledWith('te1', 'u1');
  });

  it('remove maps failure', async () => {
    mockService.delete.mockResolvedValue(Result.fail('locked'));
    await expect(controller.remove('te1', u)).rejects.toThrow(BadRequestException);
  });

  describe('getWeek', () => {
    it('rejects missing weekStart', async () => {
      await expect(controller.getWeek(u, '' as never)).rejects.toThrow(BadRequestException);
    });

    it('forwards weekStart + optional timezone', async () => {
      mockService.getWeeklyGrid.mockResolvedValue(Result.ok({ days: [] }));
      await controller.getWeek(u, '2026-01-05', 'Europe/Paris');
      expect(mockService.getWeeklyGrid).toHaveBeenCalledWith('u1', '2026-01-05', 'Europe/Paris');
    });

    it('omitted timezone passes undefined through', async () => {
      mockService.getWeeklyGrid.mockResolvedValue(Result.ok({}));
      await controller.getWeek(u, '2026-01-05');
      expect(mockService.getWeeklyGrid).toHaveBeenCalledWith('u1', '2026-01-05', undefined);
    });

    it('maps failure', async () => {
      mockService.getWeeklyGrid.mockResolvedValue(Result.fail('bad week'));
      await expect(controller.getWeek(u, '2026-01-05')).rejects.toThrow(BadRequestException);
    });
  });

  describe('lock', () => {
    it('forwards range + optional userId', async () => {
      mockService.lockPeriod.mockResolvedValue(Result.ok({ locked: 5 }));
      await controller.lock({ from: '2026-01-01', to: '2026-01-31', userId: 'u2' } as never);
      expect(mockService.lockPeriod).toHaveBeenCalledWith('2026-01-01', '2026-01-31', 'u2');
    });

    it('maps failure', async () => {
      mockService.lockPeriod.mockResolvedValue(Result.fail('bad range'));
      await expect(
        controller.lock({ from: 'x', to: 'y' } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('ProjectTimeEntriesController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: ProjectTimeEntriesController;

  beforeEach(() => {
    mockService = {
      findProjectEntries: jest.fn(),
      getSummary: jest.fn(),
    };
    controller = new ProjectTimeEntriesController(mockService as never);
  });

  it('list forwards filters', async () => {
    mockService.findProjectEntries.mockResolvedValue(Result.ok([]));
    await controller.list('p1', '2026-01-01', '2026-12-31', 'u2');
    expect(mockService.findProjectEntries).toHaveBeenCalledWith('p1', {
      from: '2026-01-01',
      to: '2026-12-31',
      userId: 'u2',
    });
  });

  it('list maps failure', async () => {
    mockService.findProjectEntries.mockResolvedValue(Result.fail('bad'));
    await expect(controller.list('p1')).rejects.toThrow(BadRequestException);
  });

  it('getSummary returns service value', async () => {
    mockService.getSummary.mockResolvedValue(Result.ok({ byUser: [], byActivity: [] }));
    expect(await controller.getSummary('p1')).toEqual({ byUser: [], byActivity: [] });
  });

  it('getSummary maps failure', async () => {
    mockService.getSummary.mockResolvedValue(Result.fail('bad'));
    await expect(controller.getSummary('p1')).rejects.toThrow(BadRequestException);
  });
});
