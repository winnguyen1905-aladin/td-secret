import { Worker, Job } from 'bullmq';
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server as SocketIOServer } from 'socket.io';
import {
  NOTIFICATION_QUEUE_CONFIG,
  QUEUE_NAMES,
  QueueEventType,
  NotificationPayload,
  JobStatusUpdatedNotification,
} from './notification-job.dto';

type NotificationJob = NotificationPayload;

@Injectable()
export class NotificationConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationConsumerService.name);
  private worker: Worker<NotificationJob> | null = null;
  private io: SocketIOServer | null = null;

  constructor(private readonly config: ConfigService) {}

  setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<NotificationJob>(
      QUEUE_NAMES.NOTIFICATIONS,
      async (job) => this.processJob(job),
      {
        connection: {
          host: this.config.get('REDIS_HOST', NOTIFICATION_QUEUE_CONFIG.REDIS_HOST),
          port: this.config.get('REDIS_PORT', NOTIFICATION_QUEUE_CONFIG.REDIS_PORT),
          password: this.config.get('REDIS_PASSWORD', NOTIFICATION_QUEUE_CONFIG.REDIS_PASSWORD),
        },
        concurrency: NOTIFICATION_QUEUE_CONFIG.CONCURRENCY,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      }
    );

    this.worker.on('completed', (job) => this.logger.debug(`Job ${job.id} completed`));
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`));
    this.worker.on('error', (err) => this.logger.error('Worker error:', err));

    this.logger.log(`Consumer "${QUEUE_NAMES.NOTIFICATIONS}" initialized`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.logger.log('Consumer closed');
  }

  private async processJob(job: Job<NotificationJob>): Promise<void> {
    const { eventType } = job.data;

    switch (eventType) {
      case QueueEventType.JOB_STATUS_UPDATED:
        await this.handleJobStatusUpdated(job.data as JobStatusUpdatedNotification);
        break;
      default:
        this.logger.warn(`Unknown event type: ${eventType}`);
    }
  }

  private async handleJobStatusUpdated(notification: JobStatusUpdatedNotification): Promise<void> {
    const { data } = notification;
    this.logger.log(`Job ${data.jobId}: ${data.previousStatus} → ${data.newStatus}`);

    if (this.io) {
      this.io.to(`job:${data.jobId}`).emit('jobStatusUpdated', {
        jobId: data.jobId,
        previousStatus: data.previousStatus,
        newStatus: data.newStatus,
        transactions: data.transactions,
        timestamp: notification.timestamp,
      });
    }
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
