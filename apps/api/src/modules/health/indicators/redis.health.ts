import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator
  extends HealthIndicator
  implements OnModuleDestroy
{
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    super();
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(redisUrl, { lazyConnect: true, enableReadyCheck: false });
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.client.ping();
      const isHealthy = result === 'PONG';
      const indicator = this.getStatus(key, isHealthy);
      if (!isHealthy) {
        throw new HealthCheckError(`${key} ping failed`, indicator);
      }
      return indicator;
    } catch (error) {
      if (error instanceof HealthCheckError) throw error;
      const indicator = this.getStatus(key, false);
      throw new HealthCheckError(`${key} is not available`, indicator);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
