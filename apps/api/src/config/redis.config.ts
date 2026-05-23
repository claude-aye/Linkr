import { ConfigService } from '@nestjs/config';
import { BullRootModuleOptions } from '@nestjs/bullmq';

export const getRedisConfig = async (
  configService: ConfigService,
): Promise<BullRootModuleOptions> => {
  const redisUrl = configService.getOrThrow<string>('REDIS_URL');
  const url = new URL(redisUrl);

  return {
    connection: {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      ...(url.password && { password: decodeURIComponent(url.password) }),
      db:
        url.pathname && url.pathname !== '/'
          ? parseInt(url.pathname.slice(1), 10)
          : 0,
    },
  };
};
