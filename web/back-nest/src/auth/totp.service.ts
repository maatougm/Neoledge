import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';
import * as qrcode from 'qrcode';

const APP_NAME = 'NeoLeadge';

@Injectable()
export class TotpService {
  /**
   * Generate a new TOTP secret and corresponding otpauth URL for a user.
   */
  generateSecret(email: string): { secret: string; otpauthUrl: string } {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
      label: email,
      issuer: APP_NAME,
      secret,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
    });
    return { secret, otpauthUrl };
  }

  /**
   * Generate a QR code as a base64 data URL from the given otpauth URL.
   */
  async generateQrCode(otpauthUrl: string): Promise<string> {
    return qrcode.toDataURL(otpauthUrl);
  }

  /**
   * Verify a TOTP token against the provided secret.
   * Returns true if the token is valid.
   */
  async verify(token: string, secret: string): Promise<boolean> {
    const result = await otpVerify({ token, secret });
    return result.valid;
  }
}
