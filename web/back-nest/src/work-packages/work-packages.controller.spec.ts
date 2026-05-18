import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Result } from '../common/result.js';
import {
  MyTasksController,
  WorkPackagesController,
  WorkPackageCustomFieldsController,
} from './work-packages.controller.js';

describe('MyTasksController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: MyTasksController;
  const u = { userId: 'u1', role: 'Member' };

  beforeEach(() => {
    mockService = {
      findForAssignee: jest.fn(),
      findTodayForAssignee: jest.fn(),
    };
    controller = new MyTasksController(mockService as never);
  });

  it('myTasks parses numeric query params', async () => {
    mockService.findForAssignee.mockResolvedValue(Result.ok({ items: [] }));
    await controller.myTasks(u, 'Active', 'q', 'p1', 's1', '2', '20');
    expect(mockService.findForAssignee).toHaveBeenCalledWith('u1', {
      status: 'Active',
      q: 'q',
      projectId: 'p1',
      sprintId: 's1',
      page: 2,
      limit: 20,
    });
  });

  it('myTasks omits undefined numeric params', async () => {
    mockService.findForAssignee.mockResolvedValue(Result.ok({ items: [] }));
    await controller.myTasks(u);
    expect(mockService.findForAssignee).toHaveBeenCalledWith('u1', {
      status: undefined,
      q: undefined,
      projectId: undefined,
      sprintId: undefined,
      page: undefined,
      limit: undefined,
    });
  });

  it('myTasks maps failure to BadRequestException', async () => {
    mockService.findForAssignee.mockResolvedValue(Result.fail('bad'));
    await expect(controller.myTasks(u)).rejects.toThrow(BadRequestException);
  });

  it('myTasksToday defaults limit to 6', async () => {
    mockService.findTodayForAssignee.mockResolvedValue(Result.ok([]));
    await controller.myTasksToday(u);
    expect(mockService.findTodayForAssignee).toHaveBeenCalledWith('u1', 6);
  });

  it('myTasksToday parses explicit limit', async () => {
    mockService.findTodayForAssignee.mockResolvedValue(Result.ok([]));
    await controller.myTasksToday(u, '10');
    expect(mockService.findTodayForAssignee).toHaveBeenCalledWith('u1', 10);
  });

  it('myTasksToday maps failure to BadRequestException', async () => {
    mockService.findTodayForAssignee.mockResolvedValue(Result.fail('bad'));
    await expect(controller.myTasksToday(u)).rejects.toThrow(BadRequestException);
  });
});

describe('WorkPackagesController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: WorkPackagesController;
  const pm = { userId: 'pm1', role: 'ProjectManager' };
  const member = { userId: 'm1', role: 'Member' };

  beforeEach(() => {
    mockService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      moveCard: jest.fn(),
      addWatcher: jest.fn(),
      removeWatcher: jest.fn(),
      addDependency: jest.fn(),
      removeDependency: jest.fn(),
      upsertCustomValues: jest.fn(),
      bulkAssign: jest.fn(),
      suggestAssignments: jest.fn(),
    };
    controller = new WorkPackagesController(mockService as never);
  });

  it('findAll forwards parsed filters', async () => {
    mockService.findAll.mockResolvedValue(Result.ok({ items: [] }));
    await controller.findAll('p1', 'Active', 'Task', 'High', 'a1', 's1', 'v1', 'p-parent', 'q', '1', '10');
    const [, filters] = mockService.findAll.mock.calls[0];
    expect(filters).toMatchObject({
      status: 'Active',
      type: 'Task',
      priority: 'High',
      assigneeId: 'a1',
      sprintId: 's1',
      versionId: 'v1',
      parentId: 'p-parent',
      q: 'q',
      page: 1,
      limit: 10,
    });
  });

  it('findAll treats parentId="null" as null', async () => {
    mockService.findAll.mockResolvedValue(Result.ok({ items: [] }));
    await controller.findAll('p1', undefined, undefined, undefined, undefined, undefined, undefined, 'null');
    const [, filters] = mockService.findAll.mock.calls[0];
    expect(filters.parentId).toBeNull();
  });

  it('findAll maps failure to BadRequestException', async () => {
    mockService.findAll.mockResolvedValue(Result.fail('bad'));
    await expect(controller.findAll('p1')).rejects.toThrow(BadRequestException);
  });

  it('findOne returns service value', async () => {
    mockService.findOne.mockResolvedValue(Result.ok({ id: 'wp1' }));
    expect(await controller.findOne('p1', 'wp1')).toEqual({ id: 'wp1' });
  });

  it('findOne maps failure to NotFoundException', async () => {
    mockService.findOne.mockResolvedValue(Result.fail('missing'));
    await expect(controller.findOne('p1', 'wp1')).rejects.toThrow(NotFoundException);
  });

  it('create forwards args', async () => {
    mockService.create.mockResolvedValue(Result.ok({ id: 'wp1' }));
    await controller.create('p1', { title: 'X' } as never, pm);
    expect(mockService.create).toHaveBeenCalledWith('p1', { title: 'X' }, 'pm1');
  });

  it('create maps failure to BadRequestException', async () => {
    mockService.create.mockResolvedValue(Result.fail('bad'));
    await expect(controller.create('p1', {} as never, pm)).rejects.toThrow(BadRequestException);
  });

  it('update forwards id+projectId+dto+user(role)', async () => {
    mockService.update.mockResolvedValue(Result.ok({ id: 'wp1' }));
    await controller.update('p1', 'wp1', { status: 'Done' } as never, pm);
    expect(mockService.update).toHaveBeenCalledWith('wp1', 'p1', { status: 'Done' }, 'pm1', 'ProjectManager');
  });

  it('update maps failure to BadRequestException', async () => {
    mockService.update.mockResolvedValue(Result.fail('forbidden field'));
    await expect(controller.update('p1', 'wp1', {} as never, member)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('remove + maps failure', async () => {
    mockService.softDelete.mockResolvedValue(Result.ok());
    await controller.remove('p1', 'wp1');
    expect(mockService.softDelete).toHaveBeenCalledWith('wp1', 'p1');

    mockService.softDelete.mockResolvedValue(Result.fail('missing'));
    await expect(controller.remove('p1', 'wp1')).rejects.toThrow(BadRequestException);
  });

  it('move forwards dto', async () => {
    mockService.moveCard.mockResolvedValue(Result.ok({ id: 'wp1' }));
    await controller.move('p1', 'wp1', { status: 'InProgress' } as never);
    expect(mockService.moveCard).toHaveBeenCalledWith('wp1', { status: 'InProgress' }, 'p1');
  });

  it('move maps failure to BadRequestException', async () => {
    mockService.moveCard.mockResolvedValue(Result.fail('bad'));
    await expect(controller.move('p1', 'wp1', {} as never)).rejects.toThrow(BadRequestException);
  });

  describe('addWatcher', () => {
    it('allows self-subscription', async () => {
      mockService.addWatcher.mockResolvedValue(Result.ok({ id: 'wp1' }));
      await controller.addWatcher('wp1', { userId: 'm1' }, member);
      expect(mockService.addWatcher).toHaveBeenCalledWith('wp1', 'm1');
    });

    it('allows Admin/PM to subscribe others', async () => {
      mockService.addWatcher.mockResolvedValue(Result.ok({ id: 'wp1' }));
      await controller.addWatcher('wp1', { userId: 'someone-else' }, pm);
      expect(mockService.addWatcher).toHaveBeenCalledWith('wp1', 'someone-else');
    });

    it('blocks Member from subscribing others', async () => {
      await expect(
        controller.addWatcher('wp1', { userId: 'other' }, member),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps service failure', async () => {
      mockService.addWatcher.mockResolvedValue(Result.fail('already watching'));
      await expect(controller.addWatcher('wp1', { userId: 'm1' }, member)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('removeWatcher', () => {
    it('allows self-removal', async () => {
      mockService.removeWatcher.mockResolvedValue(Result.ok());
      await controller.removeWatcher('wp1', 'm1', member);
      expect(mockService.removeWatcher).toHaveBeenCalledWith('wp1', 'm1');
    });

    it('blocks Member from removing other watchers', async () => {
      await expect(controller.removeWatcher('wp1', 'other', member)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('maps service failure', async () => {
      mockService.removeWatcher.mockResolvedValue(Result.fail('not found'));
      await expect(controller.removeWatcher('wp1', 'm1', member)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('addDependency defaults type to "relates"', async () => {
    mockService.addDependency.mockResolvedValue(Result.ok({ id: 'd1' }));
    await controller.addDependency('wp1', { toWpId: 'wp2' } as never);
    expect(mockService.addDependency).toHaveBeenCalledWith('wp1', 'wp2', 'relates');
  });

  it('addDependency forwards explicit type', async () => {
    mockService.addDependency.mockResolvedValue(Result.ok({ id: 'd1' }));
    await controller.addDependency('wp1', { toWpId: 'wp2', type: 'blocks' } as never);
    expect(mockService.addDependency).toHaveBeenCalledWith('wp1', 'wp2', 'blocks');
  });

  it('addDependency maps failure', async () => {
    mockService.addDependency.mockResolvedValue(Result.fail('cycle'));
    await expect(controller.addDependency('wp1', { toWpId: 'wp2' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('removeDependency forwards depId only', async () => {
    mockService.removeDependency.mockResolvedValue(Result.ok());
    await controller.removeDependency('d1');
    expect(mockService.removeDependency).toHaveBeenCalledWith('d1');
  });

  it('upsertCustomValues defaults to [] when no values', async () => {
    mockService.upsertCustomValues.mockResolvedValue(Result.ok());
    const out = await controller.upsertCustomValues('wp1', {} as never);
    expect(out).toEqual({ success: true });
    expect(mockService.upsertCustomValues).toHaveBeenCalledWith('wp1', []);
  });

  it('upsertCustomValues maps failure', async () => {
    mockService.upsertCustomValues.mockResolvedValue(Result.fail('bad'));
    await expect(controller.upsertCustomValues('wp1', { values: [{ fieldId: 'f1', value: 'v' }] } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('bulkAssign forwards args + sprintId', async () => {
    mockService.bulkAssign.mockResolvedValue(Result.ok({ updated: 2 }));
    await controller.bulkAssign('p1', { assignments: [{ wpId: 'w1', assigneeId: 'a1' }], sprintId: 's1' } as never, pm);
    expect(mockService.bulkAssign).toHaveBeenCalledWith(
      'p1',
      [{ wpId: 'w1', assigneeId: 'a1' }],
      'pm1',
      's1',
    );
  });

  it('bulkAssign maps failure', async () => {
    mockService.bulkAssign.mockResolvedValue(Result.fail('outsider'));
    await expect(
      controller.bulkAssign('p1', { assignments: [] } as never, pm),
    ).rejects.toThrow(BadRequestException);
  });

  it('suggestAssignments forwards wpIds', async () => {
    mockService.suggestAssignments.mockResolvedValue(Result.ok({ items: [] }));
    await controller.suggestAssignments('p1', { wpIds: ['w1', 'w2'] } as never);
    expect(mockService.suggestAssignments).toHaveBeenCalledWith('p1', ['w1', 'w2']);
  });

  it('suggestAssignments maps failure', async () => {
    mockService.suggestAssignments.mockResolvedValue(Result.fail('boom'));
    await expect(controller.suggestAssignments('p1', { wpIds: [] } as never)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('WorkPackageCustomFieldsController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: WorkPackageCustomFieldsController;

  beforeEach(() => {
    mockService = {
      listCustomFields: jest.fn(),
      createCustomField: jest.fn(),
      deleteCustomField: jest.fn(),
    };
    controller = new WorkPackageCustomFieldsController(mockService as never);
  });

  it('list returns service value', async () => {
    mockService.listCustomFields.mockResolvedValue(Result.ok([{ id: 'f1' }]));
    expect(await controller.list('p1')).toEqual([{ id: 'f1' }]);
  });

  it('list maps failure', async () => {
    mockService.listCustomFields.mockResolvedValue(Result.fail('bad'));
    await expect(controller.list('p1')).rejects.toThrow(BadRequestException);
  });

  it('create rejects empty name', async () => {
    await expect(controller.create('p1', { name: '  ', fieldType: 'text' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('create trims name + defaults type', async () => {
    mockService.createCustomField.mockResolvedValue(Result.ok({ id: 'f1' }));
    await controller.create('p1', { name: '  X  ', fieldType: '' });
    expect(mockService.createCustomField).toHaveBeenCalledWith('p1', 'X', 'text', undefined);
  });

  it('create forwards explicit type + options', async () => {
    mockService.createCustomField.mockResolvedValue(Result.ok({ id: 'f1' }));
    await controller.create('p1', { name: 'X', fieldType: 'select', options: 'a,b' });
    expect(mockService.createCustomField).toHaveBeenCalledWith('p1', 'X', 'select', 'a,b');
  });

  it('create maps failure', async () => {
    mockService.createCustomField.mockResolvedValue(Result.fail('duplicate'));
    await expect(controller.create('p1', { name: 'X', fieldType: 'text' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('remove + maps failure', async () => {
    mockService.deleteCustomField.mockResolvedValue(Result.ok());
    await controller.remove('f1');
    expect(mockService.deleteCustomField).toHaveBeenCalledWith('f1');

    mockService.deleteCustomField.mockResolvedValue(Result.fail('in use'));
    await expect(controller.remove('f1')).rejects.toThrow(BadRequestException);
  });
});
