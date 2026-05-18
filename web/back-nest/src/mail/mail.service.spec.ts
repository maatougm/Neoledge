/**
 * @file mail.service.spec.ts — unit tests for the SMTP wrapper. We mock the
 * nodemailer module so no real transport is constructed.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

// Mock nodemailer via factory — nodemailer exports are read-only ES module
// getters on modern node, so direct assignment to createTransport fails with
// "Cannot set property … which has only a getter". The factory form gives us
// a plain object whose props are writable jest mocks.
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailer = require('nodemailer') as { createTransport: jest.Mock };

function buildConfigMock(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

async function buildService(values: Record<string, string | undefined>): Promise<{
  service: MailService;
  sendMail: jest.Mock;
  config: ConfigService;
}> {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });
  nodemailer.createTransport.mockReturnValue({ sendMail });
  const config = buildConfigMock(values);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MailService,
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  const service = module.get<MailService>(MailService);
  return { service, sendMail, config };
}

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('initialises a transporter when EMAIL_ENABLED=true', async () => {
      await buildService({
        EMAIL_ENABLED: 'true',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
      });
      expect(nodemailer.createTransport).toHaveBeenCalledWith({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'user', pass: 'pass' },
      });
    });

    it('does NOT initialise a transporter when EMAIL_ENABLED is missing or false', async () => {
      await buildService({ EMAIL_ENABLED: 'false' });
      expect(nodemailer.createTransport).not.toHaveBeenCalled();
    });

    it('defaults SMTP_PORT to 587 when unset', async () => {
      await buildService({ EMAIL_ENABLED: 'true' });
      const call = nodemailer.createTransport.mock.calls[0][0] as { port: number };
      expect(call.port).toBe(587);
    });
  });

  describe('send', () => {
    it('no-op (logs only) when EMAIL_ENABLED is false', async () => {
      const { service, sendMail } = await buildService({ EMAIL_ENABLED: 'false' });
      await service.send('alice@example.com', 'Hello', '<p>Hi</p>');
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends through the transporter when enabled', async () => {
      const { service, sendMail } = await buildService({
        EMAIL_ENABLED: 'true',
        SMTP_FROM: 'NeoLeadge <noreply@neoleadge.com>',
      });
      await service.send('alice@example.com', 'Hello', '<p>Hi</p>');
      expect(sendMail).toHaveBeenCalledWith({
        from: 'NeoLeadge <noreply@neoleadge.com>',
        to: 'alice@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });
    });

    it('falls back to a default From when SMTP_FROM is unset', async () => {
      const { service, sendMail } = await buildService({ EMAIL_ENABLED: 'true' });
      await service.send('bob@example.com', 'Hi', '<p>Body</p>');
      const call = sendMail.mock.calls[0][0] as { from: string };
      expect(call.from).toBe('NeoLeadge <noreply@neoleadge.com>');
    });

    it('does NOT throw when the transporter rejects', async () => {
      const { service, sendMail } = await buildService({ EMAIL_ENABLED: 'true' });
      sendMail.mockRejectedValue(new Error('SMTP 535 auth failed'));
      await expect(
        service.send('alice@example.com', 'subj', 'body'),
      ).resolves.toBeUndefined();
    });
  });
});
