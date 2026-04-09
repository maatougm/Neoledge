import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const enabled = config.get<string>('EMAIL_ENABLED') === 'true';

    if (enabled) {
      this.transporter = nodemailer.createTransport({
        host: config.get<string>('SMTP_HOST'),
        port: Number(config.get<string>('SMTP_PORT') ?? '587'),
        secure: false,
        auth: {
          user: config.get<string>('SMTP_USER'),
          pass: config.get<string>('SMTP_PASS'),
        },
      });

      this.logger.log('Email transport initialised');
    } else {
      this.logger.log('Email transport disabled (EMAIL_ENABLED != true) — emails will be logged only');
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[EMAIL DISABLED] To: ${to} | Subject: ${subject}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM') ?? 'NeoLeadge <noreply@neoleadge.com>',
        to,
        subject,
        html,
      });
      this.logger.debug(`Email sent to ${to}: ${subject}`);
    } catch (err: unknown) {
      this.logger.error(
        `Failed to send email to ${to}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
