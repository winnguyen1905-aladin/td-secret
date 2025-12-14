/**
 * FIFO Message Task Queue partitioned by jobId.
 * Messages within the same job are processed sequentially (ordered by timestamp).
 * Different jobs are processed in parallel.
 */

type MessageTask<T = any> = () => Promise<T>;

interface QueuedMessage<T = any> {
  timestamp: number;
  task: MessageTask<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

class JobMessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private lastProcessedTimestamp = 0;

  /**
   * Enqueue a message task with timestamp ordering.
   * Messages are sorted by timestamp before processing.
   */
  async enqueue<T>(timestamp: number, task: MessageTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ timestamp, task, resolve, reject });
      // Sort by timestamp to ensure chronological order
      this.queue.sort((a, b) => a.timestamp - b.timestamp);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;
    const { timestamp, task, resolve, reject } = item;

    try {
      // Check for out-of-order messages (late arrivals)
      if (timestamp < this.lastProcessedTimestamp) {
        console.warn(
          `[JobMessageQueue] Out-of-order message detected. ` +
          `Current: ${timestamp}, Last processed: ${this.lastProcessedTimestamp}`
        );
      }

      const result = await task();
      this.lastProcessedTimestamp = Math.max(this.lastProcessedTimestamp, timestamp);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing = false;
      // Process next message in queue
      this.processNext();
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  get lastTimestamp(): number {
    return this.lastProcessedTimestamp;
  }
}

/**
 * Global message task queue manager.
 * Maintains separate FIFO queues for each job (jobId).
 * - Messages within the same job are processed sequentially (timestamp order)
 * - Different jobs are processed in parallel
 */
export class MessageTaskQueueManager {
  private static instance: MessageTaskQueueManager;
  private queues: Map<string, JobMessageQueue> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private lastActivity: Map<string, number> = new Map();

  private constructor() {
    // Start periodic cleanup of idle queues
    this.startCleanupInterval();
  }

  static getInstance(): MessageTaskQueueManager {
    if (!MessageTaskQueueManager.instance) {
      MessageTaskQueueManager.instance = new MessageTaskQueueManager();
    }
    return MessageTaskQueueManager.instance;
  }

  /**
   * Enqueue a message task for a specific job.
   * Messages are processed in timestamp order within each job.
   * @param jobId - The job identifier (partition key)
   * @param timestamp - Message timestamp for ordering
   * @param task - Async function to execute
   * @returns Promise that resolves when the task completes
   */
  async enqueue<T>(jobId: string, timestamp: number, task: MessageTask<T>): Promise<T> {
    let queue = this.queues.get(jobId);
    if (!queue) {
      queue = new JobMessageQueue();
      this.queues.set(jobId, queue);
    }

    // Track activity for cleanup
    this.lastActivity.set(jobId, Date.now());

    return queue.enqueue(timestamp, task);
  }

  /**
   * Convenience method to wrap a task and enqueue it.
   * @param jobId - The job identifier
   * @param timestamp - Message timestamp
   * @param handler - The actual message handler function
   * @param args - Arguments to pass to the handler
   */
  async enqueueHandler<T>(
    jobId: string,
    timestamp: number,
    handler: (...args: any[]) => Promise<T>,
    ...args: any[]
  ): Promise<T> {
    return this.enqueue(jobId, timestamp, () => handler(...args));
  }

  /**
   * Remove the queue for a job (call when job is completed/destroyed)
   */
  removeJob(jobId: string): void {
    this.queues.delete(jobId);
    this.lastActivity.delete(jobId);
    console.log(`[MessageTaskQueue] Removed queue for job: ${jobId}`);
  }

  /**
   * Get statistics for a job's queue
   */
  getQueueStats(jobId: string): {
    pendingCount: number;
    isProcessing: boolean;
    lastTimestamp: number;
  } | null {
    const queue = this.queues.get(jobId);
    if (!queue) {
      return null;
    }
    return {
      pendingCount: queue.pendingCount,
      isProcessing: queue.isProcessing,
      lastTimestamp: queue.lastTimestamp,
    };
  }

  /**
   * Get all active job IDs with queues
   */
  getActiveJobs(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get global statistics
   */
  getGlobalStats(): {
    activeJobs: number;
    totalPending: number;
    processingJobs: number;
  } {
    let totalPending = 0;
    let processingJobs = 0;

    for (const queue of this.queues.values()) {
      totalPending += queue.pendingCount;
      if (queue.isProcessing) {
        processingJobs++;
      }
    }

    return {
      activeJobs: this.queues.size,
      totalPending,
      processingJobs,
    };
  }

  /**
   * Start periodic cleanup of idle job queues
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleQueues();
    }, this.IDLE_TIMEOUT_MS);
  }

  /**
   * Clean up queues that have been idle for too long
   */
  private cleanupIdleQueues(): void {
    const now = Date.now();
    const jobsToRemove: string[] = [];

    for (const [jobId, lastActiveTime] of this.lastActivity.entries()) {
      const queue = this.queues.get(jobId);
      // Only cleanup if queue is empty and idle
      if (
        queue &&
        queue.pendingCount === 0 &&
        !queue.isProcessing &&
        now - lastActiveTime > this.IDLE_TIMEOUT_MS
      ) {
        jobsToRemove.push(jobId);
      }
    }

    for (const jobId of jobsToRemove) {
      this.removeJob(jobId);
      console.log(`[MessageTaskQueue] Auto-cleaned idle queue for job: ${jobId}`);
    }
  }

  /**
   * Destroy the manager (cleanup resources)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.queues.clear();
    this.lastActivity.clear();
  }
}

// Export singleton instance
export const messageTaskQueue = MessageTaskQueueManager.getInstance();

/**
 * Decorator to wrap a method with job-based message queue execution.
 * The decorated method must receive payload with jobId and timestamp.
 */
export function QueuedByJob() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Extract jobId and timestamp from payload (typically second argument after socket)
      const payload = args[1]; // Assuming payload is second arg after socket
      const jobId = payload?.jobId;
      const timestamp = payload?.timestamp || Date.now();

      if (!jobId) {
        console.warn(
          `[QueuedByJob] No jobId found for ${propertyKey}, executing without queue`
        );
        return originalMethod.apply(this, args);
      }

      return messageTaskQueue.enqueue(jobId, timestamp, () =>
        originalMethod.apply(this, args)
      );
    };

    return descriptor;
  };
}

/**
 * Higher-order function to wrap any async handler with job queue.
 * Useful for cases where decorator cannot be used.
 */
export function withJobQueue<T>(
  jobId: string,
  timestamp: number,
  handler: () => Promise<T>
): Promise<T> {
  return messageTaskQueue.enqueue(jobId, timestamp, handler);
}
