/**
 * Injection token for the shared ioredis client.
 *
 * Lives apart from `redis.module.ts` so a consumer that only needs the token
 * can import it without pulling in the module class.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
