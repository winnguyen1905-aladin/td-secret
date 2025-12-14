import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { CallBaseGateway, AuthenticatedSocket } from './streaming-base.gateway';
import { StreamingService } from './streaming.service';
import {
  JoinRoomData,
  ConnectTransportData,
  StartProducingData,
  ConsumeMediaData,
  UnpauseConsumerData,
  AcceptJoinRoomData,
  KickOutRoomData,
  BlockUserData,
} from '@/modules/streaming/interfaces/streaming-events.interface';
import { TransportRequestDto } from '../transport/transport.types';
import { Client } from '@/models';
import { randomUUID } from 'crypto';

@WebSocketGateway({
  namespace: '',
  cors: {
    origin: [
      /^http:\/\/localhost(?::\d+)?$/,
      /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
      /^https:\/\/([a-z0-9-]+\.)*aladin\.work(?::\d+)?$/i,
    ],
  },
})
export class StreamingGateway extends CallBaseGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly callService: StreamingService) {
    super();
  }

  override async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    await super.handleConnection(socket);
  }

  override async handleDisconnect(
    socket: AuthenticatedSocket
  ): Promise<void> {
    await super.handleDisconnect(socket);
    this.callService.handleLeaveRoom(socket);
  }

  // ============================================================
  // CALL SPECIFIC HANDLERS
  // ============================================================

  @SubscribeMessage("leaveRoom")
  async handleLeaveRoom(@ConnectedSocket() socket: AuthenticatedSocket) {
    this.callService.handleLeaveRoom(socket);
  }

  /**
   * Direct join room - for owners or when approval is not required.
   */
  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: JoinRoomData
  ) {
    if (data.userName) (socket.data.client as Client).displayName = data.userName;
    const client = socket.data.client as Client;
    try {
      const response = await this.callService.handleJoinRoom(client, data);
      if (!response.error && client.room) {
        await this.joinRoom(socket, client.room.roomId);
      }
      return response;
    } catch (error) {
      this.logger.error('Join room error:', error);
      return { error: 'Failed to join room' };
    }
  }

  @SubscribeMessage('requestTransport')
  async requestTransport(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() transportRequest: TransportRequestDto
  ) {
    try {
      return await this.callService.handleRequestTransport(
        this.extractClientFromSocket(socket),
        transportRequest
      );
    } catch (error: any) {
      this.logger.error('Request transport error:', error);
      return { error: error?.message ?? 'Failed to create transport' };
    }
  }

  @SubscribeMessage('connectTransport')
  async connectTransport(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: ConnectTransportData
  ) {
    try {
      return await this.callService.handleConnectTransport(
        this.extractClientFromSocket(socket),
        data
      );
    } catch (error: any) {
      this.logger.error('Connect transport error:', error);
      return 'error';
    }
  }

  @SubscribeMessage('startProducing')
  async startProducing(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() producingData: StartProducingData
  ) {
    try {
      return await this.callService.handleStartProducing(
        this.extractClientFromSocket(socket),
        producingData
      );
    } catch (error: any) {
      this.logger.error('Start producing error:', error);
      return { error: error?.message ?? 'Failed to start producing' };
    }
  }

  @SubscribeMessage('audioChange')
  audioChange(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() typeOfChange: string
  ) {
    this.callService.handleAudioChange(
      this.extractClientFromSocket(socket),
      typeOfChange
    );
  }

  @SubscribeMessage('closeProducers')
  async closeProducers(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { producerIds: string[] }
  ) {
    try {
      const client = this.extractClientFromSocket(socket);

      if (!client.room) {
        this.logger.warn('[Server] No room found for client');
        return;
      }

      this.logger.log(
        `[Server] Closing ${data.producerIds.length} producers for ${client.userId}`
      );

      let closedScreenAudio = false;
      let closedScreenVideo = false;

      data.producerIds.forEach((pid) => {
        for (const [kind, producer] of Object.entries(client.producer)) {
          if (producer?.id === pid) {
            this.logger.log(`[Server] Closing ${kind} producer ${pid}`);
            producer.close();
            delete client.producer[kind];

            if (kind === 'screenAudio') closedScreenAudio = true;
            if (kind === 'screenVideo') closedScreenVideo = true;
            break;
          }
        }

        const index = client.room!.activeSpeakerList.indexOf(pid);
        if (index > -1) {
          client.room!.activeSpeakerList.splice(index, 1);
          this.logger.log(`[Server] Removed producer ${pid} from active speakers`);
        }
        this.broadcastToRoom(client.room!.roomId, 'producerClosed', {
          producerId: pid,
          userId: socket.data.user?.sub,
        });
      });

      // If both screen producers are closed, close the upstream transport if it's separate
      // Note: In the current implementation, screen share uses the same upstreamTransport
      // If you create a separate transport for screen share, add logic here to close it
      if (closedScreenAudio && closedScreenVideo) {
        this.logger.log(`[Server] Both screen producers closed for ${client.userId}`);
      }

      this.logger.log(
        `[Server] Successfully closed and broadcasted ${data.producerIds.length} producers`
      );
    } catch (error) {
      this.logError('Error handling closeProducers', error, socket);
    }
  }

  @SubscribeMessage('consumeMedia')
  async consumeMedia(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: ConsumeMediaData
  ) {
    try {
      return await this.callService.handleConsumeMedia(
        this.extractClientFromSocket(socket),
        data
      );
    } catch (error) {
      this.logger.error('Consume media error:', error);
      return 'consumeFailed';
    }
  }

  @SubscribeMessage('unpauseConsumer')
  async unpauseConsumer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: UnpauseConsumerData
  ) {
    try {
      return await this.callService.handleUnpauseConsumer(
        this.extractClientFromSocket(socket),
        data
      );
    } catch (error) {
      this.logger.error('Error unpausing consumer:', error);
      return 'error';
    }
  }

  // ============================================================
  // JOIN REQUEST / MODERATION HANDLERS
  // ============================================================

  // /**
  //  * Request to join a room - sends request to owner for approval.
  //  */
  // @SubscribeMessage('joinRoomRequest')
  // async handleJoinRoomRequest(
  //   @ConnectedSocket() socket: AuthenticatedSocket,
  //   @MessageBody() data: JoinRoomData
  // ) {
  //   const client = this.extractClientFromSocket(socket);

  //   try {
  //     const response = await this.callService.handleJoinRoomRequest(client, data);

  //     if (!response.error && !response.pendingApproval && client.room) {
  //       await this.joinRoom(socket, client.room.roomId);
  //     }
  //     return response;
  //   } catch (error) {
  //     this.logger.error('Join room request error:', error);
  //     return { error: 'Failed to request room join' };
  //   }
  // }

  // /**
  //  * Owner accepts a pending join request.
  //  */
  // @SubscribeMessage('acceptJoinRoom')
  // async handleAcceptJoinRoom(
  //   @ConnectedSocket() socket: AuthenticatedSocket,
  //   @MessageBody() data: AcceptJoinRoomData
  // ) {
  //   try {
  //     return await this.callService.handleAcceptJoinRoom(
  //       this.extractClientFromSocket(socket),
  //       data
  //     );
  //   } catch (error) {
  //     this.logger.error('Accept join room error:', error);
  //     return { error: 'Failed to accept join request' };
  //   }
  // }

  // /**
  //  * Owner rejects a pending join request.
  //  */
  // @SubscribeMessage('rejectJoinRoom')
  // async handleRejectJoinRoom(
  //   @ConnectedSocket() socket: AuthenticatedSocket,
  //   @MessageBody() data: { requestId: string }
  // ) {
  //   try {
  //     return await this.callService.handleRejectJoinRoom(
  //       this.extractClientFromSocket(socket),
  //       data
  //     );
  //   } catch (error) {
  //     this.logger.error('Reject join room error:', error);
  //     return { error: 'Failed to reject join request' };
  //   }
  // }

  // /**
  //  * Owner kicks a user out of the room.
  //  */
  // @SubscribeMessage('kickOutRoom')
  // async handleKickOutRoom(
  //   @ConnectedSocket() socket: AuthenticatedSocket,
  //   @MessageBody() data: KickOutRoomData
  // ) {
  //   try {
  //     return await this.callService.handleKickOutRoom(
  //       this.extractClientFromSocket(socket),
  //       data
  //     );
  //   } catch (error) {
  //     this.logger.error('Kick out room error:', error);
  //     return { error: 'Failed to kick user' };
  //   }
  // }

  // /**
  //  * Owner blocks a user - kicks and adds to blacklist.
  //  */
  // @SubscribeMessage('blockUser')
  // async handleBlockUser(
  //   @ConnectedSocket() socket: AuthenticatedSocket,
  //   @MessageBody() data: BlockUserData
  // ) {
  //   try {
  //     return await this.callService.handleBlockUser(
  //       this.extractClientFromSocket(socket),
  //       data
  //     );
  //   } catch (error) {
  //     this.logger.error('Block user error:', error);
  //     return { error: 'Failed to block user' };
  //   }
  // }
}
