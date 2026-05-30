import { BadRequestException } from '@nestjs/common';
import { Result } from '../common/result.js';
import { WpCommentsController } from './wp-comments.controller.js';

describe('WpCommentsController', () => {
  let mockService: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let controller: WpCommentsController;
  const u = { userId: 'u1' };

  beforeEach(() => {
    mockService = {
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    controller = new WpCommentsController(mockService as never);
  });

  it('list returns service value', async () => {
    mockService.list.mockResolvedValue(Result.ok([{ id: 'c1' }]));
    expect(await controller.list('p1', 'wp1')).toEqual([{ id: 'c1' }]);
    expect(mockService.list).toHaveBeenCalledWith('wp1', 'p1');
  });

  it('list maps failure to BadRequestException', async () => {
    mockService.list.mockResolvedValue(Result.fail('bad'));
    await expect(controller.list('p1', 'wp1')).rejects.toThrow(BadRequestException);
  });

  it('create rejects empty content', async () => {
    await expect(controller.create('p1', 'wp1', { content: '  ' }, u)).rejects.toThrow(BadRequestException);
    await expect(controller.create('p1', 'wp1', { content: '' }, u)).rejects.toThrow(BadRequestException);
  });

  it('create forwards args (incl. projectId for WP-in-project check)', async () => {
    mockService.create.mockResolvedValue(Result.ok({ id: 'c1', content: 'hi' }));
    expect(await controller.create('p1', 'wp1', { content: 'hi' }, u)).toEqual({ id: 'c1', content: 'hi' });
    expect(mockService.create).toHaveBeenCalledWith('wp1', 'u1', 'hi', 'p1');
  });

  it('create maps failure', async () => {
    mockService.create.mockResolvedValue(Result.fail('not a member'));
    await expect(controller.create('p1', 'wp1', { content: 'hi' }, u)).rejects.toThrow(BadRequestException);
  });

  it('update rejects empty content', async () => {
    await expect(controller.update('c1', { content: '   ' }, u)).rejects.toThrow(BadRequestException);
  });

  it('update forwards args', async () => {
    mockService.update.mockResolvedValue(Result.ok({ id: 'c1', content: 'edited' }));
    expect(await controller.update('c1', { content: 'edited' }, u)).toEqual({ id: 'c1', content: 'edited' });
    expect(mockService.update).toHaveBeenCalledWith('c1', 'u1', 'edited');
  });

  it('update maps failure', async () => {
    mockService.update.mockResolvedValue(Result.fail('not author'));
    await expect(controller.update('c1', { content: 'edited' }, u)).rejects.toThrow(BadRequestException);
  });

  it('remove forwards args', async () => {
    mockService.delete.mockResolvedValue(Result.ok());
    await controller.remove('c1', u);
    expect(mockService.delete).toHaveBeenCalledWith('c1', 'u1');
  });

  it('remove maps failure', async () => {
    mockService.delete.mockResolvedValue(Result.fail('not author'));
    await expect(controller.remove('c1', u)).rejects.toThrow(BadRequestException);
  });
});
