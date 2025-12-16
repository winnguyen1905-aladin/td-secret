import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { INestApplication, Logger, OnModuleDestroy } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter implements OnModuleDestroy {

  private pubClient: Redis;
  private subClient: Redis;
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(private app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const configService = this.app.get(ConfigService);
    const port = configService.get<number>('REDIS_PORT', 6379);
    const password = configService.get<string>('REDIS_PASSWORD');
    const host = configService.get<string>('REDIS_HOST', 'localhost');

    const redisOptions = {
      host,
      port,
      password,
      retryStrategy: (times: number) => {
        // Simple retry strategy
        return Math.min(times * 50, 2000);
      },
    };

    this.logger.log(`Connecting to Redis at ${host}:${port}`);

    this.pubClient = new Redis(redisOptions);
    this.subClient = new Redis(redisOptions);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.pubClient.once('ready', () => {
            this.logger.log('Redis Pub Client Connected');
            resolve();
        });
        this.pubClient.once('error', (err) => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        this.subClient.once('ready', () => {
            this.logger.log('Redis Sub Client Connected');
            resolve();
        });
        this.subClient.once('error', (err) => reject(err));
      }),
    ]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
       ...options,
        pingTimeout: 20000,
        pingInterval: 25000,
    });
    server.adapter(this.adapterConstructor);
    return server;
  }

  async close() {
    try {
      if (this.pubClient && this.pubClient.status === 'ready') {
        await this.pubClient.quit();
        this.logger.log('Redis Pub Client closed');
      }
      if (this.subClient && this.subClient.status === 'ready') {
        await this.subClient.quit();
        this.logger.log('Redis Sub Client closed');
      }
    } catch (error) {
      this.logger.error('Error closing Redis clients:', error);
    }
  }

  async onModuleDestroy() {
    await this.close();
  }
}
