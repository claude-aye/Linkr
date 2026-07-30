import {
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
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
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
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
