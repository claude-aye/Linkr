import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Hard ceiling on any single Redis command, measured from the moment it is
 * issued: ioredis arms this timer inside `sendCommand`, *before* it checks
 * whether the socket is writable, so it bounds total wall time including any
 * connect or queue wait. A cache must never cost more than the call it exists
 * to avoid — a hung Redis can add at most this much to `GET /geocode`. A
 * same-network Redis answers GET in well under 5 ms, so this leaves ~40x
 * headroom before a healthy hit could ever trip it.
 */
const COMMAND_TIMEOUT_MS = 200;

/**
 * How long one connection attempt may sit idle before ioredis kills the socket
 * (default 10_000). Commands never wait on this — `enableOfflineQueue: false`
 * rejects them immediately while disconnected — but a tighter value keeps the
 * reconnect loop cycling instead of holding a dead socket open for 10 s.
 */
const CONNECT_TIMEOUT_MS = 1000;

/**
 * How often the supervisor below checks that the client is still on its way
 * back. Cheap enough to run forever (a status comparison), long enough that it
 * is not itself a source of churn.
 */
const RECONNECT_WATCHDOG_INTERVAL_MS = 5_000;

/**
 * How long the client may sit outside `ready` without emitting a single
 * lifecycle event before we stop believing it is retrying.
 *
 * A live reconnect loop is noisy by construction: every cycle emits `close`
 * then `reconnecting`, the default retryStrategy caps its delay at 2 s and
 * `connectTimeout` caps an attempt at 1 s, so a healthy loop is never silent
 * for more than ~3 s. Ten seconds is over three times that — long enough never
 * to fire on a loop that is merely waiting, short enough to bound recovery.
 */
const STALL_TIMEOUT_MS = 10_000;

/** Statuses whose arrival proves the client is still cycling. */
const LIFECYCLE_EVENTS = [
  'connecting',
  'connect',
  'ready',
  'close',
  'reconnecting',
  'end',
] as const;

const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Redis => {
    const logger = new Logger('RedisModule');
    const client = new Redis(configService.getOrThrow<string>('REDIS_URL'), {
      // Commands issued while disconnected are rejected on the spot instead of
      // piling into the offline queue. This is the fail-fast switch: a caller
      // treats the rejection as a cache miss and carries on.
      enableOfflineQueue: false,
      commandTimeout: COMMAND_TIMEOUT_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Reach `ready` as soon as the socket is up rather than after an extra
      // INFO round trip. Narrows the window in which commands fail fast right
      // after boot; a server still loading from disk simply answers -LOADING,
      // which callers already treat as a miss.
      enableReadyCheck: false,
      // NOTE: `lazyConnect` is deliberately NOT set. It is incompatible with
      // `enableOfflineQueue: false`: the first command would find the client in
      // status "wait", kick off connect() without awaiting it, then fail the
      // writable check and be rejected — so the first geocode after every boot
      // would miss unconditionally, even against a healthy Redis. Eager connect
      // has no boot cost: the constructor calls connect() and drops the promise,
      // so nothing here waits on Redis.
    });

    // ioredis attaches no default 'error' listener; with none, it falls back to
    // console.error on every failed reconnect attempt, bypassing Nest's logger
    // and flooding stderr. Attaching one is what makes an unreachable Redis a
    // non-event. Logged at debug, not warn: the default retryStrategy retries
    // forever, so the same error recurs every ~2 s — `/health` is the intended
    // signal for "Redis is down", not the application log.
    //
    // Note that this listener going quiet does NOT mean Redis came back: once
    // the client reaches status "end", `silentEmit` drops error events before
    // any listener sees them. That silence is what `superviseConnection` below
    // exists to catch.
    client.on('error', (err: Error) => {
      logger.debug(`Redis client error: ${err.message}`);
    });

    return client;
  },
};

/**
 * Shared ioredis client, in the spirit of common/storage and common/geocoding:
 * one provider behind an injection token, module imported explicitly.
 *
 * Non-global (like GeocodingModule, unlike StorageModule): its only consumer
 * today is the geocoding seam, which imports it explicitly — the tighter wiring.
 *
 * Redis is **not** abstracted behind a port, on purpose: we are not going to
 * swap providers, and the one abstraction that earns its keep here
 * (`IGeocodingService`) already exists.
 *
 * `modules/health/indicators/redis.health.ts` keeps its own private client;
 * folding it onto this seam is a separate concern.
 */
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  private watchdog: NodeJS.Timeout | null = null;

  private lastLifecycleEventAt = Date.now();

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  onModuleInit(): void {
    const noteProgress = (): void => {
      this.lastLifecycleEventAt = Date.now();
    };
    for (const event of LIFECYCLE_EVENTS) {
      this.client.on(event, noteProgress);
    }

    this.watchdog = setInterval(
      () => this.superviseConnection(),
      RECONNECT_WATCHDOG_INTERVAL_MS,
    );
    // Never a reason to keep the process alive: the supervisor exists to heal a
    // long-running API, not to outlive it.
    this.watchdog.unref();
  }

  /**
   * ioredis reconnects on its own, but only along one path: a stream event
   * reaches `closeHandler`, which consults `retryStrategy` and arms the next
   * attempt. The default strategy never gives up, so a *refused* Redis retries
   * forever and comes back by itself. Two states fall outside that path, and
   * from either one the cache is dead until the process restarts:
   *
   * - **`end` is terminal.** `Redis#connect` sets it directly when the
   *   connector rejects, without consulting `retryStrategy` and without going
   *   through `closeHandler`, so no attempt is ever armed. Nothing in the
   *   library leaves this status, and `silentEmit` drops every subsequent
   *   error, so it fails silently — the debug log simply goes quiet.
   * - **`connecting` has no unconditional watchdog.** `connectTimeout` is
   *   armed as a socket idle-timeout and only inside `if (stream.connecting)`.
   *   An attempt whose socket never reports connect, error or close therefore
   *   parks here forever: no event means `closeHandler` never runs, and
   *   `connect()` refuses to start a fresh attempt while in this status, so
   *   even an armed timer would reject harmlessly.
   *
   * Hence a supervisor rather than a configuration change: no `retryStrategy`
   * can help, because in both cases it is never called.
   */
  private superviseConnection(): void {
    const { status } = this.client;
    if (status === 'ready') {
      return;
    }

    if (status === 'end') {
      // Terminal and unambiguous — there is nothing to wait for.
      this.logger.debug(
        'Redis client is in terminal status "end" — restarting the connection',
      );
      void this.client.connect().catch(() => {
        // Redis is still unreachable. Either the client fell back into the
        // normal reconnect loop, or it returned to "end" and the next tick
        // tries again. A cache failure is never allowed to surface.
      });
      return;
    }

    // Any other status means ioredis claims to be working on it. Take it at its
    // word for as long as it keeps emitting.
    if (Date.now() - this.lastLifecycleEventAt < STALL_TIMEOUT_MS) {
      return;
    }

    this.logger.debug(
      `Redis client stalled in status "${status}" — forcing a reconnect`,
    );
    // Count the intervention itself as progress. Tearing the socket down
    // normally emits `close` straight away, which refreshes this anyway; doing
    // it here too means that even an intervention that emits nothing at all
    // (a connector holding no stream) is retried once per stall window rather
    // than on every tick, so the debug log cannot run away.
    this.lastLifecycleEventAt = Date.now();
    // `true` = "reconnect afterwards": unlike the no-argument form it leaves
    // `manuallyClosing` unset, so tearing the dead socket down produces the
    // `close` event that puts `closeHandler` — and with it the ordinary retry
    // loop — back in charge.
    this.client.disconnect(true);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }

    try {
      // QUIT drains in flight and closes politely. It is itself a command, so
      // it rejects when the client never reached a server (status "end", or
      // "reconnecting" with the offline queue off) — hence the fallback, which
      // tears the socket down without going over the wire.
      await this.client.quit();
    } catch (err) {
      this.logger.debug(`Redis QUIT failed, forcing disconnect: ${String(err)}`);
      this.client.disconnect();
    }
  }
}
