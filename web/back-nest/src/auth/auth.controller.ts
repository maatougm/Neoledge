import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { TotpCodeDto, TotpLoginDto } from './dto/totp-enable.dto.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Auth')
@Controller('')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Standard Login ──────────────────────────────────────────────────────────

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user — returns JWT or TOTP challenge' })
  @ApiResponse({ status: 200, description: 'Login successful or TOTP required' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    try {
      return await this.authService.login(dto.email, dto.password);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid email or password');
    }
  }

  // ── TOTP Login (step 2) ─────────────────────────────────────────────────────

  @Post('auth/login/totp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete TOTP challenge after step-1 login' })
  @ApiResponse({ status: 200, description: 'TOTP verified — full JWT returned' })
  @ApiResponse({ status: 401, description: 'Invalid or expired temp token / bad TOTP code' })
  async loginWithTotp(@Body() dto: TotpLoginDto) {
    try {
      return await this.authService.loginWithTotp(dto.tempToken, dto.code);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Code invalide.');
    }
  }

  // ── Password Change ─────────────────────────────────────────────────────────

  @Post('auth/change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password incorrect' })
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
    return { message: 'Password changed successfully' };
  }

  // ── 2FA Management ──────────────────────────────────────────────────────────

  @Get('auth/2fa/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current 2FA status for authenticated user' })
  @ApiResponse({ status: 200, description: '2FA status returned' })
  async getTotpStatus(@CurrentUser() user: { userId: string }) {
    return this.authService.getTotpStatus(user.userId);
  }

  @Post('auth/2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate TOTP secret and QR code — does NOT enable 2FA yet' })
  @ApiResponse({ status: 200, description: 'Secret and QR code returned' })
  async setupTotp(@CurrentUser() user: { userId: string }) {
    return this.authService.setupTotp(user.userId);
  }

  @Post('auth/2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm TOTP code and enable 2FA' })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code' })
  async enableTotp(
    @CurrentUser() user: { userId: string },
    @Body() dto: TotpCodeDto,
  ) {
    await this.authService.enableTotp(user.userId, dto.code);
    return { message: '2FA activée avec succès.' };
  }

  @Post('auth/2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify TOTP code and disable 2FA' })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code' })
  async disableTotp(
    @CurrentUser() user: { userId: string },
    @Body() dto: TotpCodeDto,
  ) {
    await this.authService.disableTotp(user.userId, dto.code);
    return { message: '2FA désactivée avec succès.' };
  }
}
