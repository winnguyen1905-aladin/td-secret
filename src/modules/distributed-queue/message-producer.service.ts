import { Queue } from 'bullmq';
import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { MessageJobData, QUEUE_CONFIG } from './message-job.dto';

interface MessageJob {
  eventType: string;
  data: MessageJobData;
  timestamp: number;
}

@Injectable()
export class MessageProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageProducerService.name);
  private queue!: Queue<MessageJob>;
  private readonly IDEMPOTENCY_PREFIX = 'msg:idem:';
  private readonly IDEMPOTENCY_TTL = 3600;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<MessageJob>(QUEUE_CONFIG.QUEUE_NAME, {
      connection: {
        host: this.config.get('REDIS_HOST', QUEUE_CONFIG.REDIS_HOST),
        port: this.config.get('REDIS_PORT', QUEUE_CONFIG.REDIS_PORT),
        password: this.config.get('REDIS_PASSWORD', QUEUE_CONFIG.REDIS_PASSWORD),
      },
      defaultJobOptions: {
        attempts: QUEUE_CONFIG.MAX_RETRY,
        backoff: { type: 'exponential', delay: QUEUE_CONFIG.RETRY_DELAY },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400 },
      },
    });

    this.queue.on('error', (err) => this.logger.error('Queue error:', err));
    this.logger.log(`Queue "${QUEUE_CONFIG.QUEUE_NAME}" initialized`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.logger.log('Queue closed');
  }

  async queueMessage(data: MessageJobData): Promise<{ jobId: string; isDuplicate: boolean }> {
    const key = `${this.IDEMPOTENCY_PREFIX}${data.id}`;

    // Idempotency check
    const cached = await this.redis.get(key);
    if (cached) {
      return { jobId: JSON.parse(cached).jobId, isDuplicate: true };
    }

    const job = await this.queue.add(`message.created`, {
      eventType: 'message.created',
      data,
      timestamp: Date.now(),
    }, {
      jobId: data.id,
      deduplication: { id: data.id, ttl: 5000 },
    });

    await this.redis.setex(key, this.IDEMPOTENCY_TTL, JSON.stringify({ jobId: job.id }));
    return { jobId: job.id!, isDuplicate: false };
  }

  async getMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed };
  }

  async pause(): Promise<void> { await this.queue.pause(); }
  async resume(): Promise<void> { await this.queue.resume(); }
  async getJob(jobId: string) { return this.queue.getJob(jobId); }

  getStatus() {
    return {
      queueName: QUEUE_CONFIG.QUEUE_NAME,
      mode: 'producer',
      redis: `${this.config.get('REDIS_HOST')}:${this.config.get('REDIS_PORT')}`,
    };
  }
}
