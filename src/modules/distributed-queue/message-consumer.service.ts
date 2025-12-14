import { Worker, Job } from 'bullmq';
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import {
  NOTIFICATION_QUEUE_CONFIG,
  QUEUE_NAMES,
  QueueEventType,
  NotificationPayload,
  JobStatusUpdatedNotification,
} from './notification-job.dto';
import { NotificationEmitterService } from './notification-emitter.service';

type NotificationJob = NotificationPayload;

@Injectable()
export class NotificationConsumerService implements OnModuleInit, OnModuleDestroy {

  private worker: Worker<NotificationJob> | null = null;
  private readonly logger = new Logger(NotificationConsumerService.name);

  constructor(private readonly notificationEmitter: NotificationEmitterService) {}

  async onModuleInit(): Promise<void> {
    const connection = {
      host: NOTIFICATION_QUEUE_CONFIG.REDIS_HOST,
      port: NOTIFICATION_QUEUE_CONFIG.REDIS_PORT,
      ...(NOTIFICATION_QUEUE_CONFIG.REDIS_PASSWORD && {
        password: NOTIFICATION_QUEUE_CONFIG.REDIS_PASSWORD || 'redis_secret',
      }),
    };

    this.worker = new Worker<NotificationJob>(
      QUEUE_NAMES.NOTIFICATIONS,
      async (job: Job<NotificationJob>) => {
        await this.processJob(job);
      },
      {
        connection,
        concurrency: NOTIFICATION_QUEUE_CONFIG.CONCURRENCY,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      }
    );

    this.worker.on('completed', (job) => this.logger.debug(`Job ${job.id} completed`));
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`));
    this.worker.on('error', (err) => this.logger.error('Worker error:', err));

    console.log(`[NotificationConsumer] ✅ Initialized`);
    console.log(`  📦 Queue: ${QUEUE_NAMES.NOTIFICATIONS}`);
    console.log(`  🔄 Concurrency: ${NOTIFICATION_QUEUE_CONFIG.CONCURRENCY}`);
    console.log(`  📡 Redis: ${NOTIFICATION_QUEUE_CONFIG.REDIS_HOST}:${NOTIFICATION_QUEUE_CONFIG.REDIS_PORT}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    console.log(`[NotificationConsumer] ❌ Closed`);
    this.logger.log('Consumer closed');
  }

  /**
   * Process a single job from the queue
   */
  private async processJob(job: Job<NotificationJob>): Promise<void> {
    const notification = job.data;
    const { eventType, eventId } = notification;

    console.log(`[NotificationConsumer] Processing job ${job.id} - ${eventType} (${eventId})`);

    try {
      switch (eventType) {
        case QueueEventType.JOB_STATUS_UPDATED:
          await this.handleJobStatusUpdated(notification as JobStatusUpdatedNotification);
          break;

        default:
          console.warn(`[NotificationConsumer] Unknown event type: ${eventType}`);
      }

      console.log(`[NotificationConsumer] ✅ Job ${job.id} processed successfully`);
    } catch (error) {
      console.error(`[NotificationConsumer] ❌ Failed to process job ${job.id}:`, error);
      throw error; // Re-throw to trigger retry
    }
  }

  /**
   * Handle job status updated notification
   */
  private async handleJobStatusUpdated(notification: JobStatusUpdatedNotification): Promise<void> {
    const { data } = notification;
    const { jobId, previousStatus, newStatus, transactions } = data;

    console.log(
      `[NotificationConsumer] Job status updated: ${jobId} (${previousStatus} → ${newStatus})`,
      `Transactions: ${transactions.length}`
    );

    // Emit to all clients in the job room via Socket.IO
    await this.notificationEmitter.emitJobStatusUpdate(notification);
  }

  async pause(): Promise<void> { await this.worker?.pause(); }
  async resume(): Promise<void> { await this.worker?.resume(); }

  getStatus() {
    return {
      queueName: QUEUE_NAMES.NOTIFICATIONS,
      mode: 'consumer',
      isRunning: this.worker?.isRunning() ?? false,
    };
  }
}
