import { Injectable, Logger } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { JobStatusUpdatedNotification } from './notification-job.dto';

/**
 * Service for emitting notifications to connected clients via Socket.IO
 */
@Injectable()
export class NotificationEmitterService {
  private readonly logger = new Logger(NotificationEmitterService.name);
  private io: SocketIOServer | null = null;

  /**
   * Set the Socket.IO server instance
   */
  setServer(io: SocketIOServer): void {
    this.io = io;
    this.logger.log('Socket.IO server initialized for notifications');
  }

  /**
   * Emit job status update to all clients in the job room
   */
  async emitJobStatusUpdate(notification: JobStatusUpdatedNotification): Promise<void> {
    if (!this.io) {
      this.logger.warn('Socket.IO server not initialized, cannot emit notification');
      return;
    }

    const { data } = notification;
    const roomName = `job:${data.jobId}`;

    this.logger.debug(`Emitting job status update to room ${roomName}`);
    
    this.io.to(roomName).emit('jobStatusUpdated', {
      jobId: data.jobId,
      previousStatus: data.previousStatus,
      newStatus: data.newStatus,
      transactions: data.transactions,
      timestamp: notification.timestamp,
    });
  }

  /**
   * Emit a generic notification to a specific user
   */
  async emitToUser(userId: string, event: string, data: any): Promise<void> {
    if (!this.io) {
      this.logger.warn('Socket.IO server not initialized, cannot emit to user');
      return;
    }

    const roomName = `user:${userId}`;
    this.io.to(roomName).emit(event, data);
  }

  /**
   * Emit a notification to all connected clients
   */
  async broadcast(event: string, data: any): Promise<void> {
    if (!this.io) {
      this.logger.warn('Socket.IO server not initialized, cannot broadcast');
      return;
    }

    this.io.emit(event, data);
  }
}
