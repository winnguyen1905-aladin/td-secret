import { Injectable } from '@nestjs/common';
import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import { BaseGateway } from './messaging-base.gateway';
import { AuthenticatedSocket } from '../streaming/interfaces/streaming-events.interface';
import { JwtUser, err, ok } from './types';
import { ChatMessageSendPayload, Message } from './messaging-events.types';
import { WsAuth } from '@common/decorators/ws-auth.decorator';
import { AccountRequest } from '@/common/decorators/account-request.decorator';
import { MessageProducerService } from '../distributed-queue/message-producer.service';
import { UserSessionCacheService } from '../distributed-cache/session.service';
import { DistributedLockService } from '../distributed-cache/distributed-lock.service';

@Injectable()
@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: [
      /^http:\/\/localhost(?::\d+)?$/,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
      /^https:\/\/([a-z0-9-]+\.)*aladin\.work(?::\d+)?$/i,
    ],
  },
})
export class MessagingGateway extends BaseGateway {
  constructor(
    private readonly messageProducer: MessageProducerService,
    private readonly _userSessionCache: UserSessionCacheService,
    private readonly lockService: DistributedLockService,
  ) {
    super();
  }

  protected get userSessionCache(): UserSessionCacheService {
    return this._userSessionCache;
  }

  // ============================================================
  // MESSAGE EVENTS
  // ============================================================

  @WsAuth()
  @SubscribeMessage('contract:message.send')
  async handleContractMessageSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: ChatMessageSendPayload,
    @AccountRequest() user: JwtUser,
  ) {
    const { jobId } = payload;

    if (!jobId) return err('jobId is required');
    if (!payload.encryptedContent?.body) return err('Message cannot be empty');

    const result = await this.lockService.tryWithLock(jobId, async () => {
      try {
        const messageData: Message = {
          type: 'TEXT',
          timestamp: payload.timestamp,
          id: payload.id,
          senderId: user.sub,
          encryptedContent: payload.encryptedContent,
          jobId: payload.jobId,
          mimeType: payload.mimeType,
          metadata: {},
          merkleLeaf: payload.merkleLeaf,
        };

        // 1: Push to BullMQ for async persistence
        const queued = await this.messageProducer.queueMessage({ ...messageData, metadata: {} });

        if (queued.isDuplicate) {
          return ok({ delivered: true, duplicate: true, messageId: messageData.id });
        }

        // 2: Broadcast to room
        this.emitToRoom(jobId, 'contract:message.new', messageData);

        // 3: Return success (NestJS sends as ack)
        return { success: true, messageId: messageData.id, timestamp: messageData.timestamp, message: 'Handled!' };
      } catch (error: any) {
        console.log('Error sending message:', error);
        return { success: false, error: error.message || 'Failed to send message' };
      }
    });

    if (result === null) {
      return err('RESOURCE_BUSY');
    }

    return result;
  }

  @WsAuth()
  @SubscribeMessage('contract:room.join')
  async handleContractRoomJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    try {
      await this.joinRoom(socket, payload.roomId);
      return ok({ roomId: payload.roomId });
    } catch (error: any) {
      return err(error.message || 'Failed to join room');
    }
  }

  @WsAuth()
  @SubscribeMessage('contract:message.pin')
  async handleMessagePin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string; roomId: string; jobId: string; timestamp?: number },
    @AccountRequest() user: JwtUser,
  ) {
    const { jobId, timestamp = Date.now(), messageId, roomId } = payload;
    if (!jobId) return err('jobId is required');

    const result = await this.lockService.tryWithLock(jobId, async () => {
      this.emitToRoom(jobId, 'contract:message.pinned', { messageId, roomId, pinnedBy: user.sub, timestamp });
      return ok({ messageId, pinned: true });
    });

    if (result === null) {
      return err('RESOURCE_BUSY');
    }

    return result;
  }

  @WsAuth()
  @SubscribeMessage('contract:message.unpin')
  async handleMessageUnpin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string; roomId: string; jobId: string; timestamp?: number },
    @AccountRequest() user: JwtUser,
  ) {
    const { jobId, timestamp = Date.now(), messageId, roomId } = payload;
    if (!jobId) return err('jobId is required');

    const result = await this.lockService.tryWithLock(jobId, async () => {
      this.emitToRoom(jobId, 'contract:message.unpinned', { messageId, roomId, unpinnedBy: user.sub, timestamp });
      return ok({ messageId, pinned: false });
    });

    if (result === null) {
      return err('RESOURCE_BUSY');
    }

    return result;
  }

  @WsAuth()
  @SubscribeMessage('contract:message.typing')
  handleMessageTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string; isTyping: boolean },
    @AccountRequest() user: JwtUser,
  ): void {
    this.broadcastToRoom(socket, payload.roomId, 'contract:message.typing', {
      userId: user.sub,
      isTyping: payload.isTyping,
    });
  }

  @WsAuth()
  @SubscribeMessage('contract:message.read')
  async handleMessageRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { messageId: string; roomId: string; jobId: string; timestamp?: number },
    @AccountRequest() user: JwtUser,
  ) {
    const { jobId, timestamp = Date.now(), messageId, roomId } = payload;
    if (!jobId) return err('jobId is required');

    const result = await this.lockService.tryWithLock(jobId, async () => {
      this.emitToRoom(jobId, 'contract:message.read', { messageId, roomId, readBy: user.sub, timestamp });
      return ok({ messageId, read: true });
    });

    if (result === null) {
      return err('RESOURCE_BUSY');
    }

    return result;
  }

  // ============================================================
  // ROOM EVENTS
  // ============================================================

  @WsAuth()
  @SubscribeMessage('chat.room.join')
  async handleRoomJoin(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    try {
      await this.joinRoom(socket, payload.roomId);
      return ok({ roomId: payload.roomId });
    } catch (error: any) {
      return err(error.message || 'Failed to join room');
    }
  }

  @WsAuth()
  @SubscribeMessage('chat.room.leave')
  async handleRoomLeave(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: { roomId: string },
  ) {
    try {
      await this.leaveRoom(socket, payload.roomId);
      return ok({ left: true });
    } catch (error: any) {
      return err(error.message || 'Failed to leave room');
    }
  }
}


