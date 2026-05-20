import { Test, TestingModule } from '@nestjs/testing';

// ---------------------------------------------------------------------------
// We must mock `otplib` before importing the service, because the real
// package ships unbundled TypeScript that ts-jest does not transform
// inside node_modules by default. The mock is hoisted by jest.mock and
// applies to both this spec AND the service-under-test, which imports
// the same module.
//
// The mock mirrors the parts of the otplib v13 surface the service uses:
//   - generateSecret(): string             (sync, base32)
//   - generateURI({...}): string           (sync, otpauth URI)
//   - verify({token, secret}): Promise<{ valid: boolean }>
//
// Counters keep generated secrets unique across the entropy test.
// ---------------------------------------------------------------------------

let secretCounter = 0;
const VALID_TOKEN = '123456';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => {
    secretCounter += 1;
    // 32-char base32-ish — pads with A so the format test passes.
    return `SECRET${secretCounter.toString().padStart(2, '0')}AAAAAAAAAAAAAAAAAAAAAAAA`;
  }),
  generateURI: jest.fn(({ label, issuer, secret, algorithm, digits, period }: {
    label: string; issuer: string; secret: string;
    algorithm: string; digits: number; period: number;
  }) => {
    const encodedLabel = encodeURIComponent(label);
    const algoUpper = algorithm.toUpperCase();
    return `otpauth://totp/${issuer}:${encodedLabel}?secret=${secret}&issuer=${issuer}&algorithm=${algoUpper}&digits=${digits}&period=${period}`;
  }),
  verify: jest.fn(async ({ token, secret }: { token: string; secret: string }) => ({
    valid: token === VALID_TOKEN && secret.startsWith('SECRET'),
    delta: 0,
  })),
}));

// The `qrcode` module exports its functions as non-configurable bindings,
// so jest.spyOn cannot replace them. We replace the whole module with a
// jest mock and reach the bare jest.fn through the import below.
jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,FAKE'),
}));

import * as qrcode from 'qrcode';

import { TotpService } from './totp.service';
import { verify as otpVerify } from 'otplib';

// ---------------------------------------------------------------------------
// Notes on directive scope
// ---------------------------------------------------------------------------
// The directive listed several coverage targets (backup codes, replay
// protection, enable/disable on a user record). TotpService is a thin
// 3-method wrapper around otplib + qrcode with no Prisma or ConfigService
// dependency — those features simply do not exist in this implementation.
// We test what's there: generateSecret, generateQrCode, verify.
// ---------------------------------------------------------------------------

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(async () => {
    secretCounter = 0;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TotpService],
    }).compile();

    service = module.get<TotpService>(TotpService);
  });

  // ── generateSecret ─────────────────────────────────────────────────────────

  describe('generateSecret', () => {
    it('returns a base32-looking secret plus a well-formed otpauth URL', () => {
      const { secret, otpauthUrl } = service.generateSecret('user@example.com');

      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThanOrEqual(16);
      // The mock returns A-Z + digits — same charset class as real otplib base32.
      expect(secret).toMatch(/^[A-Z0-9]+=*$/);

      // RFC 6238 / Google Authenticator otpauth URI grammar:
      //   otpauth://totp/<issuer>:<label>?secret=...&issuer=...&algorithm=...
      expect(otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
      expect(otpauthUrl).toContain(`secret=${secret}`);
      expect(otpauthUrl).toContain('issuer=NeoLeadge');
      expect(otpauthUrl).toContain('algorithm=SHA1'); // the service passes 'sha1'; URI grammar uses upper
      expect(otpauthUrl).toContain('digits=6');
      expect(otpauthUrl).toContain('period=30');
      // Email is URL-encoded into the label path component.
      expect(otpauthUrl).toContain('user%40example.com');
    });

    it('produces a different secret on each call (entropy)', () => {
      const a = service.generateSecret('a@x.com').secret;
      const b = service.generateSecret('b@x.com').secret;
      expect(a).not.toBe(b);
    });

    it('honors the supplied email as the otpauth label', () => {
      const r = service.generateSecret('alice@neoleadge.com');
      expect(r.otpauthUrl).toContain('alice%40neoleadge.com');
    });

    it('uses the constant APP_NAME (NeoLeadge) as the issuer', () => {
      const r = service.generateSecret('whoever@x.com');
      expect(r.otpauthUrl).toMatch(/[?&]issuer=NeoLeadge(\b|&)/);
    });
  });

  // ── generateQrCode ─────────────────────────────────────────────────────────

  describe('generateQrCode', () => {
    it('delegates to qrcode.toDataURL and returns the resulting data URL', async () => {
      const spy = jest
        .spyOn(qrcode, 'toDataURL')
        // toDataURL has multiple overloads — we use the (text, opts?) form,
        // which returns Promise<string>. Cast to any to satisfy TS w/o
        // pulling in qrcode's heavy overload types here.
        .mockResolvedValue('data:image/png;base64,FAKE' as never);

      const url = await service.generateQrCode('otpauth://totp/x?secret=ABC&issuer=Y');
      expect(url).toBe('data:image/png;base64,FAKE');
      expect(spy).toHaveBeenCalledWith('otpauth://totp/x?secret=ABC&issuer=Y');
      spy.mockRestore();
    });

    it('propagates qrcode errors to the caller', async () => {
      const spy = jest
        .spyOn(qrcode, 'toDataURL')
        .mockImplementation((() => Promise.reject(new Error('boom'))) as never);

      await expect(service.generateQrCode('otpauth://x')).rejects.toThrow('boom');
      spy.mockRestore();
    });
  });

  // ── verify ─────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns true for the canonical valid token from our otplib stub', async () => {
      const { secret } = service.generateSecret('verify@x.com');
      await expect(service.verify(VALID_TOKEN, secret)).resolves.toBe(true);
    });

    it('returns false for an obviously-wrong token', async () => {
      const { secret } = service.generateSecret('verify@x.com');
      await expect(service.verify('000000', secret)).resolves.toBe(false);
    });

    it('returns false for a non-matching (secret, token) pair', async () => {
      // Our stub treats secrets starting with "SECRET" as valid pairs only
      // when paired with VALID_TOKEN. A different token under a real secret
      // must reject.
      const a = service.generateSecret('a@x.com').secret;
      await expect(service.verify('999999', a)).resolves.toBe(false);
    });

    it('forwards the underlying otplib `valid` flag verbatim', async () => {
      const { secret } = service.generateSecret('contract@x.com');
      const direct = await otpVerify({ token: VALID_TOKEN, secret });
      const fromService = await service.verify(VALID_TOKEN, secret);
      expect(fromService).toBe(direct.valid);
    });

    it('awaits the underlying promise — does not return a thenable', async () => {
      const { secret } = service.generateSecret('await@x.com');
      const ret = service.verify(VALID_TOKEN, secret);
      expect(ret).toBeInstanceOf(Promise);
      const resolved = await ret;
      expect(typeof resolved).toBe('boolean');
    });
  });
});
