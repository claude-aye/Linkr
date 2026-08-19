import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import { FixedWindowCounter } from './fixed-window-counter';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { RateLimitExceededException } from './rate-limit.exception';

interface RateLimitedRequest {
  user?: JwtPayload;
  ip?: string;
}

/**
 * Caps how often one caller may hit a route carrying {@link RateLimit}.
 *
 * Registered as a module-local provider, exactly like `AdminGuard` — the
 * established convention in this codebase (verifications, payments, quotes,
 * services-catalog and demand-signals all list their guard in `providers`).
 * A consequence worth stating: each module that registers it gets its own
 * instance, so counters are per module. That is harmless because every key is
 * namespaced by handler (below), so two modules can never contend for the same
 * key in the first place.
 *
 * ## ⚠️ THE KEY IS THE CALLER, NEVER THE CALLER × WHAT THEY ASKED FOR
 *
 * This is the one line in this file that must not be "improved". It is tempting
 * to key `POST /demand-signals` by caller **and category**, so that someone
 * reporting a genuinely different trade is not blocked by their own earlier
 * report. Doing so would build, in this process's memory, the very association
 * `demand_signals` refuses to hold: *this account searched for that trade*
 * (CLAUDE.md §13.1). The table's anonymity is a property of the whole system,
 * not of one storage engine — reconstructing the link somewhere else is not a
 * loophole, it is the leak.
 *
 * What the counter does hold is bounded and defensible: an account id, a
 * request count, and an expiry a few minutes out. No category, no coordinate,
 * nothing about *what* was searched — ordinary abuse control, and it is erased
 * by the sweep as soon as the window closes.
 *
 * The IP fallback exists because the mechanism is built for the anonymous
 * `discover` route that will need it (ETAT ⛔④). Note for that day: `main.ts`
 * sets no `trust proxy`, so `request.ip` is the socket peer — behind a load
 * balancer that is the balancer, and every anonymous caller would share one
 * budget. Enabling trust proxy is part of exposing a public route, not of this
 * change.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  private readonly counter = new FixedWindowCounter();

  private assumptionLogged = false;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No budget declared — the guard is inert on this route.
    if (!options) {
      return true;
    }

    this.logAssumptionOnce(context, options);

    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const key = `${context.getClass().name}.${context.getHandler().name}:${callerKey(request)}`;

    // Monotonic: this measures an elapsed interval, so a wall-clock step must
    // not be able to stretch a window or release one early.
    const verdict = this.counter.hit(
      key,
      options.limit,
      options.windowSeconds * 1000,
      performance.now(),
    );

    if (verdict.allowed) {
      return true;
    }

    // `Retry-After` is standard, costs nothing and leaks nothing: it says when
    // the window reopens, not who else has been calling.
    context
      .switchToHttp()
      .getResponse<{ header?: (name: string, value: string) => void }>()
      .header?.('Retry-After', String(verdict.retryAfterSeconds));

    this.logger.warn(
      `Rate limit hit on ${context.getClass().name}.${context.getHandler().name} ` +
        `(${options.limit} per ${options.windowSeconds}s); retry in ` +
        `${verdict.retryAfterSeconds}s`,
    );

    throw new RateLimitExceededException();
  }

  /**
   * States the per-process assumption once, on the first request that is
   * actually metered, at `log` level.
   *
   * Not in the constructor: the guard is instantiated whether or not any route
   * uses it, and a boot line about a limiter that meters nothing would be
   * noise. Not `debug` either — replication breaks this assumption silently, so
   * the assumption has to be visible in ordinary output, same call as the
   * geocoding limiter.
   */
  private logAssumptionOnce(
    context: ExecutionContext,
    options: RateLimitOptions,
  ): void {
    if (this.assumptionLogged) {
      return;
    }
    this.assumptionLogged = true;
    this.logger.log(
      `${context.getClass().name}.${context.getHandler().name} capped at ` +
        `${options.limit} requests / ${options.windowSeconds}s per caller. ` +
        'This counter is per-process and assumes a SINGLE API instance: ' +
        'replicas would multiply each caller\'s real budget by their count.',
    );
  }
}

/**
 * Who is being metered.
 *
 * The authenticated subject when there is one — stable across a caller's IP
 * changing, and the only meaningful unit on a signed-in route. The socket
 * address otherwise, which is all an anonymous route has.
 *
 * The `anonymous` bucket is the honest floor rather than an open door: if
 * neither is available, every such request shares one budget and is throttled
 * together. Failing open there would make the limiter trivially bypassable by
 * whatever condition removed the IP.
 */
function callerKey(request: RateLimitedRequest): string {
  if (request.user?.sub) {
    return `user:${request.user.sub}`;
  }
  return request.ip ? `ip:${request.ip}` : 'anonymous';
}
