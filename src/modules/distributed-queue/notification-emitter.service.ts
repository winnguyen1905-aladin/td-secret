import { Injectable, Logger } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { JobStatusUpdatedNotification } from './notification-job.dto';
import { MessagingGateway } from '../messaging';

/**
 * Socket events emitted by the notification system
 */
export const NotificationSocketEvents = {
  JOB_STATUS_UPDATED: 'notification:job.status.updated',
} as const;


/**
 * Service for emitting notifications to connected clients via Socket.IO
 */
@Injectable()
export class NotificationEmitterService {
  private readonly logger = new Logger(NotificationEmitterService.name);

  constructor(
    private readonly messagingGateway: MessagingGateway
  ) {}

  /**
   * Emit job status update to all users in the job room
   */
  async emitJobStatusUpdate(notification: JobStatusUpdatedNotification): Promise<void> {
    const { data, eventId, timestamp, source } = notification;
    const { jobId, previousStatus, newStatus, transactions } = data;

    if (!this.messagingGateway.server) {
      console.error('[NotificationEmitter] No Socket.IO context available');
      return;
    }

    // Emit to the job room (jobId is the room name)
    const payload = {
      eventId,
      timestamp,
      source,
      jobId,
      previousStatus,
      newStatus,
      transactions,
    };

    this.messagingGateway.server.to(jobId).emit(NotificationSocketEvents.JOB_STATUS_UPDATED, payload);

    console.log(
      `[NotificationEmitter] Emitted ${NotificationSocketEvents.JOB_STATUS_UPDATED} to room ${jobId}:`,
      `${previousStatus} → ${newStatus}`
    );
  }


  /**
   * Emit a generic notification to a specific user
   */
  // async emitToUser(userId: string, event: string, data: any): Promise<void> {
  //   if (!this.io) {
  //     this.logger.warn('Socket.IO server not initialized, cannot emit to user');
  //     return;
  //   }

  //   const roomName = `user:${userId}`;
  //   this.io.to(roomName).emit(event, data);
  // }

  // /**
  //  * Emit a notification to all connected clients
  //  */
  // async broadcast(event: string, data: any): Promise<void> {
  //   if (!this.io) {
  //     this.logger.warn('Socket.IO server not initialized, cannot broadcast');
  //     return;
  //   }

  //   this.io.emit(event, data);
  // }
}
