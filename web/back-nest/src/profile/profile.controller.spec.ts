import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Result } from '../common/result.js';
import { ProfileController } from './profile.controller.js';

describe('ProfileController', () => {
  let mockService: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    changePassword: jest.Mock;
    uploadAvatar: jest.Mock;
    getAvatarPath: jest.Mock;
    getPreferences: jest.Mock;
    updatePreferences: jest.Mock;
  };
  let controller: ProfileController;

  beforeEach(() => {
    mockService = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
      uploadAvatar: jest.fn(),
      getAvatarPath: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
    };
    controller = new ProfileController(mockService as never);
  });

  it('getProfile returns service value', async () => {
    mockService.getProfile.mockResolvedValue(Result.ok({ id: 'u1' }));
    expect(await controller.getProfile({ userId: 'u1' })).toEqual({ id: 'u1' });
    expect(mockService.getProfile).toHaveBeenCalledWith('u1');
  });

  it('getProfile maps failure to NotFoundException', async () => {
    mockService.getProfile.mockResolvedValue(Result.fail('missing'));
    await expect(controller.getProfile({ userId: 'u1' })).rejects.toThrow(NotFoundException);
  });

  it('updateProfile forwards user + dto', async () => {
    mockService.updateProfile.mockResolvedValue(Result.ok({ id: 'u1' }));
    await controller.updateProfile({ userId: 'u1' }, { firstName: 'Z' } as never);
    expect(mockService.updateProfile).toHaveBeenCalledWith('u1', { firstName: 'Z' });
  });

  it('updateProfile maps failure to BadRequestException', async () => {
    mockService.updateProfile.mockResolvedValue(Result.fail('bad'));
    await expect(
      controller.updateProfile({ userId: 'u1' }, {} as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('changePassword forwards (currentPassword, newPassword)', async () => {
    mockService.changePassword.mockResolvedValue(Result.ok());
    await controller.changePassword(
      { userId: 'u1' },
      { currentPassword: 'old', newPassword: 'new' } as never,
    );
    expect(mockService.changePassword).toHaveBeenCalledWith('u1', 'old', 'new');
  });

  it('changePassword maps failure to BadRequestException', async () => {
    mockService.changePassword.mockResolvedValue(Result.fail('wrong'));
    await expect(
      controller.changePassword(
        { userId: 'u1' },
        { currentPassword: 'a', newPassword: 'b' } as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('uploadAvatar forwards base64 + ext', async () => {
    mockService.uploadAvatar.mockResolvedValue(Result.ok({ url: '/a.png' }));
    const out = await controller.uploadAvatar(
      { userId: 'u1' },
      { base64Image: 'data:...', fileExtension: 'png' } as never,
    );
    expect(out).toEqual({ url: '/a.png' });
    expect(mockService.uploadAvatar).toHaveBeenCalledWith('u1', 'data:...', 'png');
  });

  it('uploadAvatar maps failure to BadRequestException', async () => {
    mockService.uploadAvatar.mockResolvedValue(Result.fail('too big'));
    await expect(
      controller.uploadAvatar({ userId: 'u1' }, { base64Image: 'd', fileExtension: 'png' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('serveAvatar sendFile on success', async () => {
    mockService.getAvatarPath.mockResolvedValue(Result.ok('/abs/path/avatar.png'));
    const sendFile = jest.fn();
    const res = { sendFile } as never;
    await controller.serveAvatar('u1', res);
    expect(sendFile).toHaveBeenCalledWith('/abs/path/avatar.png');
  });

  it('serveAvatar maps failure to NotFoundException', async () => {
    mockService.getAvatarPath.mockResolvedValue(Result.fail('missing'));
    await expect(controller.serveAvatar('u1', { sendFile: jest.fn() } as never)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getPreferences returns service value', async () => {
    mockService.getPreferences.mockResolvedValue(Result.ok({ theme: 'dark' }));
    expect(await controller.getPreferences({ userId: 'u1' })).toEqual({ theme: 'dark' });
  });

  it('updatePreferences forwards a shallow copy of the dto', async () => {
    mockService.updatePreferences.mockResolvedValue(Result.ok());
    const dto = { theme: 'light' };
    await controller.updatePreferences({ userId: 'u1' }, dto as never);
    expect(mockService.updatePreferences).toHaveBeenCalledWith('u1', { theme: 'light' });
    // shallow-copy semantics — controller spreads the dto:
    expect(mockService.updatePreferences.mock.calls[0][1]).not.toBe(dto);
  });

  it('updatePreferences maps failure to BadRequestException', async () => {
    mockService.updatePreferences.mockResolvedValue(Result.fail('bad shape'));
    await expect(
      controller.updatePreferences({ userId: 'u1' }, {} as never),
    ).rejects.toThrow(BadRequestException);
  });
});
