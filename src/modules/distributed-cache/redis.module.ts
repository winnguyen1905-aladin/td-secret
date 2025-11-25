import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';
import { UserSessionCacheService } from './session.service';
import { DistributedLockService } from './distributed-lock.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        const Redis = await import('ioredis');
        return new Redis.default({
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD', ''),
        });
      },
      inject: [ConfigService],
    },
    RedisService,
    UserSessionCacheService,
    DistributedLockService,
  ],
  exports: ['REDIS_CLIENT', RedisService, UserSessionCacheService, DistributedLockService],
})
export class RedisModule {}
