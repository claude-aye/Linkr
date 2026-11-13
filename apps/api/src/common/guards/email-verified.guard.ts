import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import { EmailNotVerifiedException } from '../../modules/auth/email-verification.exceptions';
import { UsersRepository } from '../../modules/users/users.repository';

/**
 * L3 — a write that reaches a third party requires a confirmed address.
 *
 * Applied ONLY through `@RequireVerifiedEmail()`, route by route, never as a
 * global guard (`CLAUDE.md` §13 — every new write route is classified, see
 * `require-verified-email.spec.ts`).
 *
 * ⚠️ READS THE DATABASE, NEVER A JWT CLAIM. An access token lives up to 15
 * minutes: a claim would keep blocking a user who has just confirmed, and keep
 * letting through one whose address changed. `findById` excludes soft-deleted
 * accounts, so a closed account gets the same 401 as an unknown one.
 *
 * Runs AFTER the global `JwtAuthGuard` (APP_GUARD runs first) and BEFORE the
 * handler, its pipes and interceptors (multer included): an unconfirmed caller
 * gets this 403 before any 404/403 that would reveal the target.
 *
 * `UsersRepository` is resolved through `ModuleRef` with `strict: false`, so
 * the guard works in any module without adding `UsersModule` to its imports
 * (the `payments` module, notably, is only touched by its decorator).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  private usersRepository: UsersRepository | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const payload = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    if (!payload?.sub) throw new UnauthorizedException();

    const users: UsersRepository =
      this.usersRepository ?? this.moduleRef.get(UsersRepository, { strict: false });
    this.usersRepository = users;
    const user = await users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    if (user.emailVerifiedAtUtc === null || user.emailVerifiedAtUtc === undefined) {
      throw new EmailNotVerifiedException();
    }
    return true;
  }
}
