import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import Redlock, { Lock, ResourceLockedError } from 'redlock';

export interface LockOptions {
  duration?: number;
  retryCount?: number;
  retryDelay?: number;
  retryJitter?: number;
}

const DEFAULT_LOCK_DURATION = 10000; // 10 seconds
const DEFAULT_RETRY_COUNT = 10;
const DEFAULT_RETRY_DELAY = 200; // 200ms
const DEFAULT_RETRY_JITTER = 100; // 100ms

@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {

  private redlock: Redlock;
  private readonly logger = new Logger(DistributedLockService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  onModuleInit(): void {
    this.redlock = new Redlock([this.redis], {
      driftFactor: 0.01,
      retryCount: DEFAULT_RETRY_COUNT,
      retryDelay: DEFAULT_RETRY_DELAY,
      retryJitter: DEFAULT_RETRY_JITTER,
      automaticExtensionThreshold: 500,
    });

    this.redlock.on('error', (error) => {
      if (error instanceof ResourceLockedError) {
        this.logger.debug(`Resource locked: ${error.message}`);
      } else {
        this.logger.error(`Redlock error: ${error.message}`);
      }
    });

    this.logger.log('DistributedLockService initialized with Redlock');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redlock) {
      // Prevent "Connection is closed" errors from being logged during shutdown
      this.redlock.removeAllListeners('error');
      // Add a dummy listener to prevent "Unhandled 'error' event" crashes
      this.redlock.on('error', () => {});

      try {
        await this.redlock.quit();
      } catch (error) {
        // Ignore errors during shutdown
      }
      this.logger.log('DistributedLockService destroyed');
    }
  }

  /**
   * Acquire a distributed lock for a resource
   * @param resource - Resource identifier (will be prefixed with 'lock:')
   * @param options - Lock options
   * @returns Lock object or null if failed to acquire
   */
  async acquire(resource: string, options?: LockOptions): Promise<Lock | null> {
    const lockKey = `lock:${resource}`;
    const duration = options?.duration ?? DEFAULT_LOCK_DURATION;

    try {
      const lock = await this.redlock.acquire([lockKey], duration, {
        retryCount: options?.retryCount ?? DEFAULT_RETRY_COUNT,
        retryDelay: options?.retryDelay ?? DEFAULT_RETRY_DELAY,
        retryJitter: options?.retryJitter ?? DEFAULT_RETRY_JITTER,
      });
      this.logger.debug(`Lock acquired for: ${resource}`);
      return lock;
    } catch (error) {
      if (error instanceof ResourceLockedError) {
        this.logger.debug(`Failed to acquire lock for: ${resource} (resource locked)`);
      } else {
        this.logger.error(`Failed to acquire lock for: ${resource}`, error);
      }
      return null;
    }
  }

  /**
   * Release a distributed lock
   * @param lock - Lock object to release
   */
  async release(lock: Lock): Promise<void> {
    try {
      await lock.release();
      this.logger.debug(`Lock released`);
    } catch (error) {
      this.logger.error(`Failed to release lock`, error);
    }
  }

  /**
   * Execute a task with a distributed lock
   * Automatically acquires lock, executes task, and releases lock
   * @param resource - Resource identifier
   * @param task - Async function to execute while holding the lock
   * @param options - Lock options
   * @returns Task result
   * @throws Error if lock cannot be acquired
   */
  async withLock<T>(
    resource: string,
    task: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    const lockKey = `lock:${resource}`;
    const duration = options?.duration ?? DEFAULT_LOCK_DURATION;

    return this.redlock.using([lockKey], duration, async (signal) => {
      if (signal.aborted) {
        throw new Error(`Lock aborted for resource: ${resource}`);
      }
      return task();
    });
  }

  /**
   * Try to execute a task with a distributed lock
   * Returns null if lock cannot be acquired (non-blocking)
   * @param resource - Resource identifier
   * @param task - Async function to execute while holding the lock
   * @param options - Lock options
   * @returns Task result or null if lock failed
   */
  async tryWithLock<T>(
    resource: string,
    task: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T | null> {
    const lock = await this.acquire(resource, {
      ...options,
      retryCount: options?.retryCount ?? 0, // No retries for try operations
    });

    if (!lock) {
      return null;
    }

    try {
      return await task();
    } finally {
      await this.release(lock);
    }
  }

  /**
   * Extend a lock's duration
   * @param lock - Lock to extend
   * @param duration - New duration in milliseconds
   * @returns Extended lock or null if failed
   */
  async extend(lock: Lock, duration: number = DEFAULT_LOCK_DURATION): Promise<Lock | null> {
    try {
      const extendedLock = await lock.extend(duration);
      this.logger.debug(`Lock extended for ${duration}ms`);
      return extendedLock;
    } catch (error) {
      this.logger.error(`Failed to extend lock`, error);
      return null;
    }
  }
}
