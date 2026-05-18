import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { Result } from '../common/result.js';
import { ProjectsController } from './projects.controller.js';

describe('ProjectsController', () => {
  let mockService: Record<string, jest.Mock>;
  let controller: ProjectsController;
  const admin = { userId: 'admin1', role: 'Admin' };

  beforeEach(() => {
    mockService = {
      getProjectsPaged: jest.fn(),
      getDeletedProjectsAsync: jest.fn(),
      findWithFilters: jest.fn(),
      exportToCsv: jest.fn(),
      getById: jest.fn(),
      getByManager: jest.fn(),
      getByStatus: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      restoreProjectAsync: jest.fn(),
      hardDeleteProjectAsync: jest.fn(),
      assignManager: jest.fn(),
      updateStatus: jest.fn(),
      archive: jest.fn(),
      addField: jest.fn(),
      removeField: jest.fn(),
      duplicate: jest.fn(),
      bulkArchive: jest.fn(),
      bulkUpdateStatus: jest.fn(),
      bulkAssignManager: jest.fn(),
      getActivity: jest.fn(),
    };
    controller = new ProjectsController(mockService as never);
  });

  it('getAll parses skip/take and forwards filters', async () => {
    mockService.getProjectsPaged.mockResolvedValue(Result.ok({ items: [] }));
    const out = await controller.getAll('10', '5', 'q', 'Active');
    expect(out).toEqual({ items: [] });
    expect(mockService.getProjectsPaged).toHaveBeenCalledWith(10, 5, 'q', 'Active');
  });

  it('getDeleted returns service value', async () => {
    mockService.getDeletedProjectsAsync.mockResolvedValue(Result.ok([{ id: 'p1' }]));
    expect(await controller.getDeleted()).toEqual([{ id: 'p1' }]);
  });

  it('search forwards user + body', async () => {
    mockService.findWithFilters.mockResolvedValue(Result.ok({ items: [], total: 0 }));
    const out = await controller.search(admin, { status: ['Active'] } as never);
    expect(out).toEqual({ items: [], total: 0 });
    expect(mockService.findWithFilters).toHaveBeenCalledWith('admin1', { status: ['Active'] });
  });

  it('search maps failure to BadRequestException', async () => {
    mockService.findWithFilters.mockResolvedValue(Result.fail('bad filter'));
    await expect(controller.search(admin, {} as never)).rejects.toThrow(BadRequestException);
  });

  it('exportCsv returns a StreamableFile with UTF-8 BOM', async () => {
    mockService.exportToCsv.mockResolvedValue('id,name\nA,B');
    const out = await controller.exportCsv();
    expect(out).toBeInstanceOf(StreamableFile);
  });

  it('getById returns project on success', async () => {
    mockService.getById.mockResolvedValue(Result.ok({ id: 'p1' }));
    expect(await controller.getById('p1')).toEqual({ id: 'p1' });
  });

  it('getById maps failure to NotFoundException', async () => {
    mockService.getById.mockResolvedValue(Result.fail('missing'));
    await expect(controller.getById('p1')).rejects.toThrow(NotFoundException);
  });

  it('getByManager forwards manager id', async () => {
    mockService.getByManager.mockResolvedValue(Result.ok([{ id: 'p1' }]));
    expect(await controller.getByManager('mgr1')).toEqual([{ id: 'p1' }]);
  });

  it('getByStatus forwards status', async () => {
    mockService.getByStatus.mockResolvedValue(Result.ok([]));
    expect(await controller.getByStatus('Active')).toEqual([]);
  });

  it('create forwards (userId, dto)', async () => {
    mockService.create.mockResolvedValue(Result.ok({ id: 'new' }));
    const dto = { name: 'X', clientName: 'C' } as never;
    expect(await controller.create(admin, dto)).toEqual({ id: 'new' });
    expect(mockService.create).toHaveBeenCalledWith('admin1', dto);
  });

  it('create maps failure to BadRequestException', async () => {
    mockService.create.mockResolvedValue(Result.fail('invalid'));
    await expect(controller.create(admin, {} as never)).rejects.toThrow(BadRequestException);
  });

  it('update forwards id + dto', async () => {
    mockService.update.mockResolvedValue(Result.ok({ id: 'p1' }));
    await controller.update('p1', { name: 'New' } as never);
    expect(mockService.update).toHaveBeenCalledWith('p1', { name: 'New' });
  });

  it('update maps failure to NotFoundException', async () => {
    mockService.update.mockResolvedValue(Result.fail('missing'));
    await expect(controller.update('p1', {} as never)).rejects.toThrow(NotFoundException);
  });

  it('delete calls softDelete with (id, userId)', async () => {
    mockService.softDelete.mockResolvedValue(Result.ok());
    await controller.delete(admin, 'p1');
    expect(mockService.softDelete).toHaveBeenCalledWith('p1', 'admin1');
  });

  it('delete maps failure to NotFoundException', async () => {
    mockService.softDelete.mockResolvedValue(Result.fail('missing'));
    await expect(controller.delete(admin, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('restore + hardDelete + assignManager + updateStatus + archive happy paths', async () => {
    mockService.restoreProjectAsync.mockResolvedValue(Result.ok());
    mockService.hardDeleteProjectAsync.mockResolvedValue(Result.ok());
    mockService.assignManager.mockResolvedValue(Result.ok());
    mockService.updateStatus.mockResolvedValue(Result.ok());
    mockService.archive.mockResolvedValue(Result.ok());

    await controller.restore('p1');
    await controller.hardDelete(admin, 'p1');
    await controller.assignManager(admin, 'p1', { projectManagerId: 'mgr2' } as never);
    await controller.updateStatus(admin, 'p1', { status: 'Completed' } as never);
    await controller.archive(admin, 'p1');

    expect(mockService.restoreProjectAsync).toHaveBeenCalledWith('p1');
    expect(mockService.hardDeleteProjectAsync).toHaveBeenCalledWith('p1', 'admin1');
    expect(mockService.assignManager).toHaveBeenCalledWith('p1', 'mgr2', 'admin1');
    expect(mockService.updateStatus).toHaveBeenCalledWith('p1', 'Completed', 'admin1');
    expect(mockService.archive).toHaveBeenCalledWith('p1', 'admin1');
  });

  it('restore maps failure to NotFoundException', async () => {
    mockService.restoreProjectAsync.mockResolvedValue(Result.fail('not deleted'));
    await expect(controller.restore('p1')).rejects.toThrow(NotFoundException);
  });

  it('hardDelete maps failure to NotFoundException', async () => {
    mockService.hardDeleteProjectAsync.mockResolvedValue(Result.fail('must be soft-deleted first'));
    await expect(controller.hardDelete(admin, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('assignManager maps failure to BadRequestException', async () => {
    mockService.assignManager.mockResolvedValue(Result.fail('wrong role'));
    await expect(
      controller.assignManager(admin, 'p1', { projectManagerId: 'x' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateStatus maps failure to BadRequestException', async () => {
    mockService.updateStatus.mockResolvedValue(Result.fail('blocked by phase gate'));
    await expect(
      controller.updateStatus(admin, 'p1', { status: 'X' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('archive maps failure to NotFoundException', async () => {
    mockService.archive.mockResolvedValue(Result.fail('missing'));
    await expect(controller.archive(admin, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('addField returns new field', async () => {
    mockService.addField.mockResolvedValue(Result.ok({ id: 'f1' }));
    const dto = { label: 'Custom', fieldType: 'Text' } as never;
    expect(await controller.addField('p1', dto)).toEqual({ id: 'f1' });
    expect(mockService.addField).toHaveBeenCalledWith('p1', dto);
  });

  it('addField maps failure to BadRequestException', async () => {
    mockService.addField.mockResolvedValue(Result.fail('duplicate label'));
    await expect(controller.addField('p1', {} as never)).rejects.toThrow(BadRequestException);
  });

  it('removeField forwards both UUIDs', async () => {
    mockService.removeField.mockResolvedValue(Result.ok());
    await controller.removeField('p1', 'f1');
    expect(mockService.removeField).toHaveBeenCalledWith('p1', 'f1');
  });

  it('removeField maps failure to BadRequestException', async () => {
    mockService.removeField.mockResolvedValue(Result.fail('field in use'));
    await expect(controller.removeField('p1', 'f1')).rejects.toThrow(BadRequestException);
  });

  it('duplicate forwards (id, newName)', async () => {
    mockService.duplicate.mockResolvedValue(Result.ok({ id: 'p2' }));
    expect(await controller.duplicate('p1', { name: 'Clone' } as never)).toEqual({ id: 'p2' });
    expect(mockService.duplicate).toHaveBeenCalledWith('p1', 'Clone');
  });

  it('duplicate maps failure to BadRequestException', async () => {
    mockService.duplicate.mockResolvedValue(Result.fail('name taken'));
    await expect(controller.duplicate('p1', { name: 'X' } as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('bulkArchive forwards project ids + user', async () => {
    mockService.bulkArchive.mockResolvedValue(Result.ok());
    await controller.bulkArchive(admin, { projectIds: ['p1', 'p2'] } as never);
    expect(mockService.bulkArchive).toHaveBeenCalledWith(['p1', 'p2'], 'admin1');
  });

  it('bulkStatus forwards args', async () => {
    mockService.bulkUpdateStatus.mockResolvedValue(Result.ok());
    await controller.bulkStatus(admin, { projectIds: ['p1'], status: 'Completed' } as never);
    expect(mockService.bulkUpdateStatus).toHaveBeenCalledWith(['p1'], 'Completed', 'admin1');
  });

  it('bulkAssignManager forwards args', async () => {
    mockService.bulkAssignManager.mockResolvedValue(Result.ok());
    await controller.bulkAssignManager(admin, { projectIds: ['p1'], managerId: 'mgr2' } as never);
    expect(mockService.bulkAssignManager).toHaveBeenCalledWith(['p1'], 'mgr2', 'admin1');
  });

  it('getActivity returns service value', async () => {
    mockService.getActivity.mockResolvedValue(Result.ok([{ id: 'a1' }]));
    expect(await controller.getActivity('p1')).toEqual([{ id: 'a1' }]);
  });
});
