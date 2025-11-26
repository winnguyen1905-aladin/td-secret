import { Queue } from 'bullmq';
import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { MessageJobData, QUEUE_CONFIG } from './message-job.dto';

interface MessageJob {
  value: { eventType: string; data: MessageJobData };
  headers: Record<string, string>;
  timestamp: number;
}

@Injectable()
export class MessageProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageProducerService.name);
  private queue!: Queue<MessageJob>;
  // Idempotency key namespace
  private readonly IDEMPOTENCY_PREFIX = "idempotency:message:";
  private readonly IDEMPOTENCY_TTL = 3600; // 1 hour in seconds

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
        backoff: {
          type: "exponential",
          delay: QUEUE_CONFIG.RETRY_DELAY,
        },
        removeOnComplete: {
          age: 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 86400,
        },
      },
    });

    this.queue.on('error', (err) => this.logger.error('Queue error:', err));
    this.logger.log(`Queue "${QUEUE_CONFIG.QUEUE_NAME}" initialized`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    this.logger.log('Queue closed');
  }

   /**
   * Mark message as processed with result
   */
  async markMessageProcessed(
    idempotencyKey: string,
    result: { jobId: string; timestamp: number }
  ): Promise<void> {
    const key = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    await this.redis.setex(
      key,
      this.IDEMPOTENCY_TTL,
      JSON.stringify(result)
    );
  }

  /**
   * Check if message was already processed (idempotency check)
   */
  async isMessageProcessed(idempotencyKey: string): Promise<boolean> {
    const key = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }
  /**
 * Get cached result for duplicate request
 */
  async getCachedResult(idempotencyKey: string): Promise<any | null> {
    const key = `${this.IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }
  /**
   * Generate idempotency key
   */
  private generateIdempotencyKey(
    data: Omit<MessageJobData, "timestamp">
  ): string {
    return data.id;
  }

  async queueMessage(data: MessageJobData): Promise<{
    jobId: string;
    isDuplicate: boolean;
  }> {
    const idempotencyKey = this.generateIdempotencyKey(data);

    // >>> 🔒 IDEMPOTENCY CHECK: Check if already processed
    const alreadyProcessed = await this.isMessageProcessed(idempotencyKey);
    if (alreadyProcessed) {
      const cachedResult = await this.getCachedResult(idempotencyKey);
      return {
        isDuplicate: true,
        jobId: cachedResult?.jobId || idempotencyKey,
      };
    }

    const jobData: MessageJobData = { ...data, };
    const job = await this.queue.add(`message.created.${data.id}`, {
      value: {
        eventType: 'message.created',
        data: jobData
      },
      headers: {
        'content-type': 'application/json',
        'event-type': 'message.created',
        'test-run': 'true',
      },
      timestamp: Date.now(),
    }, {
      deduplication: {
        ttl: 5000,
        id: data.id,
      },
      jobId: data.id,
    });

    // >>> ✅ IDEMPOTENCY TRACKING: Mark as processed with result
    await this.markMessageProcessed(data.id, {
      jobId: job.id!,
      timestamp: Date.now(),
    });
    
    return {
      jobId: job.id!,
      isDuplicate: false,
    };
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
