/**
 * Queue and event type constants for notifications
 */
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  MESSAGES: 'contract.messages',
} as const;

export const QueueEventType = {
  JOB_STATUS_UPDATED: 'job.status.updated',
} as const;

/**
 * Job status enum
 */
export enum JobStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  REVIEW = 'REVIEW',
  FUNDED = 'FUNDED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED',
}

/**
 * Transaction type enum
 */
export enum TransactionType {
  ESCROW = 'ESCROW',
  WITHDRAW = 'WITHDRAW',
  REFUND = 'REFUND',
}

/**
 * Transaction status enum
 */
export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Transaction data in job status update
 */
export interface JobTransaction {
  id: string;
  txHash: string;
  txType: TransactionType;
  truthAnchor: string;
  status: TransactionStatus;
  createdAt: string;
}

/**
 * Job status update data payload
 */
export interface JobStatusUpdateData {
  jobId: string;
  previousStatus: JobStatus;
  newStatus: JobStatus;
  transactions: JobTransaction[];
}

/**
 * Base notification event structure
 */
export interface NotificationEvent<T = any> {
  eventType: string;
  eventId: string;
  timestamp: string;
  source: string;
  data: T;
}

/**
 * Job status updated notification payload
 */
export interface JobStatusUpdatedNotification extends NotificationEvent<JobStatusUpdateData> {
  eventType: typeof QueueEventType.JOB_STATUS_UPDATED;
}

/**
 * Union type for all notification types
 */
export type NotificationPayload = JobStatusUpdatedNotification;

/**
 * Notification queue configuration
 */
export const NOTIFICATION_QUEUE_CONFIG = {
  QUEUE_NAME: QUEUE_NAMES.NOTIFICATIONS,
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  
  // Consumer configuration
  CONCURRENCY: 5,
  MAX_RETRY: 3,
  RETRY_DELAY: 1000,
};
