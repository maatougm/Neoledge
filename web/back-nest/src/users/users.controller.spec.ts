import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Result } from '../common/result.js';
import { UsersController } from './users.controller.js';

describe('UsersController', () => {
  let mockService: {
    getAll: jest.Mock;
    getById: jest.Mock;
    getByRole: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    resetPassword: jest.Mock;
    deactivate: jest.Mock;
    reactivate: jest.Mock;
    delete: jest.Mock;
  };
  let controller: UsersController;

  beforeEach(() => {
    mockService = {
      getAll: jest.fn(),
      getById: jest.fn(),
      getByRole: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      resetPassword: jest.fn(),
      deactivate: jest.fn(),
      reactivate: jest.fn(),
      delete: jest.fn(),
    };
    controller = new UsersController(mockService as never);
  });

  // ── getAll ───────────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('parses skip/take/search/role and forwards to service', async () => {
      mockService.getAll.mockResolvedValue(Result.ok({ items: [], total: 0 }));
      const out = await controller.getAll('10', '5', 'foo', 'Admin');
      expect(out).toEqual({ items: [], total: 0 });
      expect(mockService.getAll).toHaveBeenCalledWith(10, 5, 'foo', 'Admin');
    });

    it('defaults skip=0 and take=20 when omitted or non-numeric', async () => {
      mockService.getAll.mockResolvedValue(Result.ok({ items: [] }));
      await controller.getAll(undefined, undefined);
      expect(mockService.getAll).toHaveBeenCalledWith(0, 20, undefined, undefined);

      await controller.getAll('abc', 'xyz');
      expect(mockService.getAll).toHaveBeenLastCalledWith(0, 20, undefined, undefined);
    });

    it('throws BadRequestException on failure Result', async () => {
      mockService.getAll.mockResolvedValue(Result.fail('boom'));
      await expect(controller.getAll()).rejects.toThrow(BadRequestException);
    });
  });

  // ── getById ──────────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns user on success', async () => {
      mockService.getById.mockResolvedValue(Result.ok({ id: 'u1' }));
      expect(await controller.getById('u1')).toEqual({ id: 'u1' });
    });

    it('maps failure to NotFoundException', async () => {
      mockService.getById.mockResolvedValue(Result.fail('not found'));
      await expect(controller.getById('u1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getByRole ────────────────────────────────────────────────────────────────
  describe('getByRole', () => {
    it('returns users for a role', async () => {
      mockService.getByRole.mockResolvedValue(Result.ok([{ id: 'u1' }]));
      expect(await controller.getByRole('Admin')).toEqual([{ id: 'u1' }]);
      expect(mockService.getByRole).toHaveBeenCalledWith('Admin');
    });

    it('maps failure to BadRequestException', async () => {
      mockService.getByRole.mockResolvedValue(Result.fail('bad role'));
      await expect(controller.getByRole('Invalid')).rejects.toThrow(BadRequestException);
    });
  });

  // ── create / update ──────────────────────────────────────────────────────────
  describe('create', () => {
    it('passes DTO through and returns the new user', async () => {
      mockService.create.mockResolvedValue(Result.ok({ id: 'new' }));
      const dto = { email: 'a@b.c', firstName: 'A', lastName: 'B' } as never;
      expect(await controller.create(dto)).toEqual({ id: 'new' });
      expect(mockService.create).toHaveBeenCalledWith(dto);
    });

    it('maps failure to BadRequestException', async () => {
      mockService.create.mockResolvedValue(Result.fail('duplicate email'));
      await expect(controller.create({} as never)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('forwards id + dto', async () => {
      mockService.update.mockResolvedValue(Result.ok({ id: 'u1', firstName: 'Z' }));
      const out = await controller.update('u1', { firstName: 'Z' } as never);
      expect(out).toEqual({ id: 'u1', firstName: 'Z' });
      expect(mockService.update).toHaveBeenCalledWith('u1', { firstName: 'Z' });
    });

    it('maps failure to BadRequestException', async () => {
      mockService.update.mockResolvedValue(Result.fail('bad'));
      await expect(controller.update('u1', {} as never)).rejects.toThrow(BadRequestException);
    });
  });

  // ── resetPassword ────────────────────────────────────────────────────────────
  describe('resetPassword', () => {
    it('returns service value on success', async () => {
      mockService.resetPassword.mockResolvedValue(Result.ok({ sent: true }));
      expect(await controller.resetPassword('u1')).toEqual({ sent: true });
    });

    it('maps failure to NotFoundException', async () => {
      mockService.resetPassword.mockResolvedValue(Result.fail('user not found'));
      await expect(controller.resetPassword('u1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivate / reactivate ──────────────────────────────────────────────────
  describe('deactivate', () => {
    it('returns French success message', async () => {
      mockService.deactivate.mockResolvedValue(Result.ok());
      const out = await controller.deactivate('u1', { userId: 'admin1' });
      expect(out).toEqual({ message: 'Utilisateur désactivé.' });
      expect(mockService.deactivate).toHaveBeenCalledWith('u1', 'admin1');
    });

    it('maps failure to BadRequestException (self-deactivate blocked)', async () => {
      mockService.deactivate.mockResolvedValue(Result.fail('cannot deactivate self'));
      await expect(controller.deactivate('admin1', { userId: 'admin1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  it('reactivate returns French success', async () => {
    mockService.reactivate.mockResolvedValue(Result.ok());
    expect(await controller.reactivate('u1')).toEqual({ message: 'Utilisateur réactivé.' });
  });

  it('reactivate maps failure to NotFoundException', async () => {
    mockService.reactivate.mockResolvedValue(Result.fail('no such user'));
    await expect(controller.reactivate('u1')).rejects.toThrow(NotFoundException);
  });

  // ── delete ───────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('returns success message', async () => {
      mockService.delete.mockResolvedValue(Result.ok());
      const out = await controller.delete('u1', { userId: 'admin1' });
      expect(out).toEqual({ message: 'Utilisateur supprimé.' });
      expect(mockService.delete).toHaveBeenCalledWith('u1', 'admin1');
    });

    it('maps failure to BadRequestException', async () => {
      mockService.delete.mockResolvedValue(Result.fail('blocker'));
      await expect(controller.delete('u1', { userId: 'admin1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
