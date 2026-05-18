import { UnauthorizedException } from '@nestjs/common';

// AuthService transitively imports otplib (via totp.service), which is an
// ESM-only package that jest can't handle without a transform config tweak.
// Stub the whole service module so the controller spec stays self-contained.
jest.mock('./auth.service.js', () => ({ AuthService: class {} }));

import { AuthController } from './auth.controller.js';

describe('AuthController', () => {
  let mockService: {
    login: jest.Mock;
    loginWithTotp: jest.Mock;
    getMe: jest.Mock;
    changePassword: jest.Mock;
    getTotpStatus: jest.Mock;
    setupTotp: jest.Mock;
    enableTotp: jest.Mock;
    disableTotp: jest.Mock;
    forgotPassword: jest.Mock;
    resetPasswordByToken: jest.Mock;
  };
  let controller: AuthController;

  beforeEach(() => {
    mockService = {
      login: jest.fn(),
      loginWithTotp: jest.fn(),
      getMe: jest.fn(),
      changePassword: jest.fn(),
      getTotpStatus: jest.fn(),
      setupTotp: jest.fn(),
      enableTotp: jest.fn(),
      disableTotp: jest.fn(),
      forgotPassword: jest.fn(),
      resetPasswordByToken: jest.fn(),
    };
    controller = new AuthController(mockService as never);
  });

  // ── login ────────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('returns the service result on success', async () => {
      mockService.login.mockResolvedValue({ jwt: 'eyJ...', user: { id: 'u1' } });
      const out = await controller.login({ email: 'a@b.c', password: 'x' } as never);
      expect(out).toEqual({ jwt: 'eyJ...', user: { id: 'u1' } });
      expect(mockService.login).toHaveBeenCalledWith('a@b.c', 'x');
    });

    it('rethrows UnauthorizedException unchanged', async () => {
      mockService.login.mockRejectedValue(new UnauthorizedException('Compte verrouillé'));
      await expect(controller.login({ email: 'a', password: 'b' } as never)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('maps a non-Unauthorized error to a generic 401', async () => {
      mockService.login.mockRejectedValue(new Error('DB down'));
      await expect(controller.login({ email: 'a', password: 'b' } as never)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.login({ email: 'a', password: 'b' } as never)).rejects.toThrow(
        'Invalid email or password',
      );
    });
  });

  // ── loginWithTotp ────────────────────────────────────────────────────────────
  describe('loginWithTotp', () => {
    it('returns service result on success', async () => {
      mockService.loginWithTotp.mockResolvedValue({ jwt: 'eyJ...' });
      const out = await controller.loginWithTotp({ tempToken: 'tmp', code: '123456' } as never);
      expect(out).toEqual({ jwt: 'eyJ...' });
      expect(mockService.loginWithTotp).toHaveBeenCalledWith('tmp', '123456');
    });

    it('rethrows UnauthorizedException unchanged', async () => {
      mockService.loginWithTotp.mockRejectedValue(new UnauthorizedException('Code expiré'));
      await expect(
        controller.loginWithTotp({ tempToken: 'tmp', code: 'x' } as never),
      ).rejects.toThrow('Code expiré');
    });

    it('maps a non-Unauthorized error to a generic French 401', async () => {
      mockService.loginWithTotp.mockRejectedValue(new Error('boom'));
      await expect(
        controller.loginWithTotp({ tempToken: 'tmp', code: 'x' } as never),
      ).rejects.toThrow('Code invalide.');
    });
  });

  // ── getMe ────────────────────────────────────────────────────────────────────
  it('getMe forwards userId', async () => {
    mockService.getMe.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    const out = await controller.getMe({ userId: 'u1' });
    expect(out).toEqual({ id: 'u1', email: 'a@b.c' });
    expect(mockService.getMe).toHaveBeenCalledWith('u1');
  });

  // ── changePassword ───────────────────────────────────────────────────────────
  it('changePassword forwards args + returns success message', async () => {
    mockService.changePassword.mockResolvedValue(undefined);
    const out = await controller.changePassword(
      { userId: 'u1' },
      { currentPassword: 'old', newPassword: 'new' } as never,
    );
    expect(out).toEqual({ message: 'Password changed successfully' });
    expect(mockService.changePassword).toHaveBeenCalledWith('u1', 'old', 'new');
  });

  // ── 2FA Management ───────────────────────────────────────────────────────────
  describe('2FA', () => {
    it('getTotpStatus returns service result', async () => {
      mockService.getTotpStatus.mockResolvedValue({ enabled: true });
      const out = await controller.getTotpStatus({ userId: 'u1' });
      expect(out).toEqual({ enabled: true });
    });

    it('setupTotp returns service secret/qr', async () => {
      mockService.setupTotp.mockResolvedValue({ secret: 'S', qrCode: 'data:...' });
      const out = await controller.setupTotp({ userId: 'u1' });
      expect(out).toEqual({ secret: 'S', qrCode: 'data:...' });
    });

    it('enableTotp returns French success', async () => {
      mockService.enableTotp.mockResolvedValue(undefined);
      const out = await controller.enableTotp({ userId: 'u1' }, { code: '123456' } as never);
      expect(out).toEqual({ message: '2FA activée avec succès.' });
      expect(mockService.enableTotp).toHaveBeenCalledWith('u1', '123456');
    });

    it('disableTotp accepts missing code (coerces to empty string)', async () => {
      mockService.disableTotp.mockResolvedValue(undefined);
      const out = await controller.disableTotp({ userId: 'u1' }, {} as never);
      expect(out).toEqual({ message: '2FA désactivée avec succès.' });
      expect(mockService.disableTotp).toHaveBeenCalledWith('u1', '');
    });

    it('disableTotp forwards code when present', async () => {
      mockService.disableTotp.mockResolvedValue(undefined);
      await controller.disableTotp({ userId: 'u1' }, { code: '999999' } as never);
      expect(mockService.disableTotp).toHaveBeenCalledWith('u1', '999999');
    });
  });

  // ── Forgot / Reset ───────────────────────────────────────────────────────────
  it('forgotPassword always returns the neutral message (no user enumeration)', async () => {
    mockService.forgotPassword.mockResolvedValue(undefined);
    const out = await controller.forgotPassword({ email: 'a@b.c' } as never);
    expect(out.message).toMatch(/Si un compte/i);
    expect(mockService.forgotPassword).toHaveBeenCalledWith('a@b.c');
  });

  it('resetPasswordByToken returns success message', async () => {
    mockService.resetPasswordByToken.mockResolvedValue(undefined);
    const out = await controller.resetPasswordByToken({ token: 't', newPassword: 'np' } as never);
    expect(out.message).toMatch(/réinitialisé/i);
    expect(mockService.resetPasswordByToken).toHaveBeenCalledWith('t', 'np');
  });

  // ── hookLogout (no-op) ───────────────────────────────────────────────────────
  it('hookLogout is a stateless no-op returning {ok:true}', () => {
    expect(controller.hookLogout()).toEqual({ ok: true });
  });
});
