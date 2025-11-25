import { Message } from "../messaging/messaging-events.types";

  /**
 * Message job data - for pushing to Redis queue
 * External server consumer will process this
 */
export interface MessageJobData extends Message {
  metadata: Record<string, any>;
}

/**
 * Queue configuration
 */
export const QUEUE_CONFIG = {
  // Queue name (must match with external server consumer)

  QUEUE_NAME: 'contract.messages',
  // Redis connection
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,

  // Retry configuration (cho consumer bên kia)
  MAX_RETRY: 5,              // Retry 5 lần để đảm bảo tính toàn vẹn
  RETRY_DELAY: 2000,         // Đợi 2 giây giữa các lần retry

  // Processing (consumer sẽ config concurrency)
  CONCURRENCY: 10,           // Gợi ý cho consumer
};
