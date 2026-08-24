import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService, TokenPair } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { SignupDto } from './dtos/signup.dto';
import { RefreshTokenDto } from './dtos/refresh-token.dto';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { AuthResponseDto } from './dtos/auth-response.dto';
import { UserPublicDto } from './dtos/user-public.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { AppleAuthGuard } from './guards/apple-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  /**
   * ⚠️ THE BUDGET IS BY IP (the guard's fallback when nobody is authenticated),
   * NEVER by email — same reasoning as `forgot-password` below: a per-email 429
   * would only ever fire for addresses that already exist, turning the limiter
   * into the enumeration oracle the generic errors exist to deny.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(AUTH_RATE_LIMITS.SIGNUP)
  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<AuthResponseDto> {
    return this.authService.signup(dto);
  }

  /**
   * ⚠️ THE GUARD ORDER IS LOAD-BEARING, AND ONE DECORATOR IS WHAT PINS IT.
   * `RateLimitGuard` MUST run before `LocalAuthGuard`, because `LocalAuthGuard`
   * is what looks the user up and rejects a bad password: put it first and a
   * failed sign-in throws 401 before the counter is ever touched, so wrong
   * passwords cost nothing and the limiter stops capping the one thing it exists
   * to cap. They are listed in ONE `@UseGuards(...)` — stacking two decorators
   * would leave the order to the direction decorators are applied in, which is
   * not something the next reader should have to know. Pinned by
   * `auth.controller.spec.ts`.
   *
   * A consequence worth stating: the 429 is therefore raised BEFORE any lookup,
   * so it is byte-identical for a known and an unknown address. It says
   * something about the caller's connection, never about the account.
   */
  @Public()
  @UseGuards(RateLimitGuard, LocalAuthGuard)
  @RateLimit(AUTH_RATE_LIMITS.LOGIN)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Req() req: Request & { user: User }): AuthResponseDto {
    return this.authService.login(req.user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Starts a password reset. ALWAYS 202, ALWAYS the same body (A-2.12).
   *
   * ⚠️ THE CONSTANT RESPONSE IS THE FEATURE. Unknown address, known address,
   * tenth request in a row, send suppressed by the per-address cap: one status,
   * one body, no timing branch a client can read as "this account exists". The
   * service never throws for a business reason, so there is no error path to
   * leak one either.
   *
   * ⚠️ THE RATE LIMIT IS BY IP (the guard's fallback when nobody is
   * authenticated), NEVER by email. A per-email 429 would only ever be emitted
   * for addresses that exist, which turns the security control into the very
   * enumeration oracle it was meant to prevent (A-2.13). The per-address cap
   * exists — it lives in the service and suppresses the SEND, not the response.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(AUTH_RATE_LIMITS.FORGOT_PASSWORD)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password reset link' })
  @ApiResponse({
    status: 202,
    description:
      'Always returned, whether or not an account exists for the address.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordResetService.requestReset(dto.email);
  }

  /**
   * Finishes a password reset: consumes the token, writes the password and
   * expels every existing session, all in one transaction.
   *
   * ⚠️ POST, AND ONLY POST, CONSUMES (A-2.7). The emailed link opens a PAGE that
   * carries a form; no GET anywhere in this flow touches the token. Mail-scanning
   * antivirus and link previewers fetch URLs before a human ever clicks, and a
   * consuming GET would burn the token before its owner saw it.
   *
   * No auto-login on success (A-2.21): the front redirects to the sign-in page.
   * The user has just proven control of the mailbox, not of the new password —
   * and typing it once, deliberately, is what catches a typo before it locks
   * them out.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(AUTH_RATE_LIMITS.RESET_PASSWORD)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiResponse({ status: 204, description: 'Password changed; sessions expelled.' })
  @ApiResponse({
    status: 400,
    description:
      'One response for every token failure — unknown, expired, already used or replaced.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordResetService.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  me(@CurrentUser() payload: JwtPayload): Promise<UserPublicDto> {
    return this.authService.me(payload.sub);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google')
  googleAuth(): void {
    // Redirect handled by Passport
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get('google/callback')
  googleCallback(@Req() req: Request & { user: AuthResponseDto }): AuthResponseDto {
    return req.user;
  }

  @Public()
  @UseGuards(AppleAuthGuard)
  @Get('apple')
  appleAuth(): void {
    // Redirect handled by Passport
  }

  @Public()
  @UseGuards(AppleAuthGuard)
  @Post('apple/callback')
  appleCallback(@Req() req: Request & { user: AuthResponseDto }): AuthResponseDto {
    return req.user;
  }
}
