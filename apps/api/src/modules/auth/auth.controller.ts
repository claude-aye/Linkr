import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RateLimitExceededException } from '../../common/rate-limit/rate-limit.exception';
import { EmailVerificationService } from './email-verification.service';
import { VerifyEmailDto } from './dtos/verify-email.dto';
import { ResendVerificationErrorDto } from './dtos/resend-verification-error.dto';
import { ResendVerificationResponseDto } from './dtos/resend-verification-response.dto';
import { AUTH_RATE_LIMITS } from './auth-rate-limits';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
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
    private readonly emailVerificationService: EmailVerificationService,
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
  // Any @ApiResponse replaces Swagger's default, so the 201 is restated.
  @ApiResponse({ status: 201, description: '' })
  @ApiResponse({
    status: 400,
    description:
      'Invalid body, or the address is a text-message gateway (body code: EMAIL_DOMAIN_NOT_ALLOWED); no account was created.',
  })
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

  /**
   * Confirms the address with the emailed token (mandate L1).
   *
   * ⚠️ POST, AND ONLY POST, CONSUMES — same rule as reset (A-2.7): mail scanners
   * prefetch links, so the emailed URL opens a web PAGE that posts the token.
   * Public, and it creates NO session and sets NO cookie: proving the mailbox is
   * not proving the password.
   *
   * The address is verified only while the token's address is still the
   * account's. Every failure is one 400 with code EMAIL_VERIFICATION_TOKEN_INVALID.
   * A valid token on an already-verified account succeeds and changes nothing.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(AUTH_RATE_LIMITS.VERIFY_EMAIL)
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm the email address with an emailed token' })
  @ApiResponse({ status: 204, description: 'Address confirmed (or already confirmed).' })
  @ApiResponse({
    status: 400,
    description:
      'One response for every token failure — unknown, expired, already used, replaced, or issued for a previous address. Body code: EMAIL_VERIFICATION_TOKEN_INVALID.',
  })
  @ApiResponse({ status: 429, description: 'Too many attempts from this IP. Retry-After set.' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.emailVerificationService.verify(dto.token);
  }

  /**
   * Sends a verification link to the authenticated user (mandate L1). Since
   * mandate A this is also the FIRST send: sign-up sends nothing.
   *
   * The user is looked up BY ID (JWT subject), never by address. Caps: 3/h per
   * user (guard), 5/day per user and 10/h per IP (service); 429 with
   * Retry-After. Each send kills the previous links. Already verified → 200
   * ALREADY_VERIFIED, nothing sent. Daily verification budget (or its resend
   * sub-cap) spent → 503 with code EMAIL_VERIFICATION_BUDGET_EXHAUSTED, no
   * token created.
   */
  @UseGuards(RateLimitGuard)
  @RateLimit(AUTH_RATE_LIMITS.RESEND_VERIFICATION)
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a new email verification link' })
  @ApiResponse({ status: 200, type: ResendVerificationResponseDto })
  @ApiResponse({ status: 401, description: 'Not authenticated.' })
  @ApiResponse({ status: 429, description: 'Resend cap reached. Retry-After set.' })
  @ApiResponse({
    status: 503,
    type: ResendVerificationErrorDto,
    description:
      "Today's verification budget (or its resend sub-cap) is spent (code EMAIL_VERIFICATION_BUDGET_EXHAUSTED), or the mail could not be queued (code EMAIL_VERIFICATION_SEND_FAILED; the previous link still works).",
  })
  async resendVerification(
    @CurrentUser() payload: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResendVerificationResponseDto> {
    const verdict = this.emailVerificationService.checkResendLimits(
      payload.sub,
      req.ip,
    );
    if (!verdict.allowed) {
      res.header('Retry-After', String(verdict.retryAfterSeconds));
      throw new RateLimitExceededException();
    }
    const status = await this.emailVerificationService.resend(payload.sub);
    return { status };
  }

  @ApiResponse({ status: 200, type: UserPublicDto })
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
