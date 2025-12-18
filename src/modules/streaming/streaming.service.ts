import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Client } from '@/models/client.model';
import { CreateRoomParams, Room } from '@/models/room.model';
import {
  JoinRoomData,
  JoinRoomResponse,
  ConnectTransportData,
  StartProducingData,
  ConsumeMediaData,
  UnpauseConsumerData,
  AuthenticatedSocket,
} from '@/modules/streaming/interfaces/streaming-events.interface';
import { TransportService } from '@/modules/transport/transport.service';
import { MediaService } from '@/modules/multimedia/media.service';
import { WorkerManagerService } from '@/modules/processor/worker.service';
import { StreamingGateway } from './streaming.gateway';
import { StreamingSTTService } from './streaming-stt.service';
import { TransportRequestDto } from '../transport/transport.types';
import appConfig from '@/config/app.config';
import { SocketHelpersUtil } from 'utils';
import { ActiveSpeakersService } from '../multimedia/active-speakers.service';
import * as mediasoup from 'mediasoup';
import { RoomService } from '@/models';
import { DistributedLockService } from '../distributed-cache/distributed-lock.service';

@Injectable()
export class StreamingService {

  private readonly logger = new Logger(StreamingService.name);
  constructor(
    private readonly roomService: RoomService,
    private readonly mediaService: MediaService,
    private readonly transportService: TransportService,
    private readonly workerManager: WorkerManagerService,
    private readonly lockService: DistributedLockService,
    private readonly activeSpeakersService: ActiveSpeakersService,
    private readonly sttService: StreamingSTTService,
    @Inject(forwardRef(() => StreamingGateway)) private readonly streamingGateway: StreamingGateway
  ) {}

  async handleLeaveRoom(socket: AuthenticatedSocket): Promise<void> {
    const client = socket.data.client as Client;
    if (!client) return;
    this.logger.log(`Handling leave room for client ${client.userId}`);
    const room = client.room;
    if (room) {
      const roomId = room.roomId;
      const workerPid = (room.worker as any)?._child?.pid ?? -1;

      const producerIds = Object.values(client.producer)
        .filter((p): p is mediasoup.types.Producer => !!p)
        .map(p => p.id);

      // STOP STT TRANSCRIPTION for this participant
      try {
        this.logger.log(`Stopping STT for participant ${client.userId}`);
        await this.sttService.stopTranscription(client.userId);
      } catch (error) {
        this.logger.error(`Failed to stop STT for ${client.userId}:`, error);
      }

      if (producerIds.length > 0) {
        room.activeSpeakerList = room.activeSpeakerList.filter(
          pid => !producerIds.includes(pid)
        );
      }

      // Clean up stale consumer references on other clients that were consuming from this client
      for (const otherClient of room.clients) {
        if (otherClient.socket.id === client.socket.id) continue;

        for (const downstream of otherClient.downstreamTransports) {
          // Check if this downstream was consuming from the disconnecting client's producers
          if (producerIds.includes(downstream.associatedAudioPid || '')) {
            // Consumer is automatically closed when producer closes, but clear the reference
            downstream.audio = null;
            downstream.associatedAudioPid = null;
          }
          if (producerIds.includes(downstream.associatedVideoPid || '')) {
            downstream.video = null;
            downstream.associatedVideoPid = null;
          }
        }
      }

      // Broadcast participantLeft BEFORE cleanup (while client is still in room)
      this.streamingGateway.server.to(roomId).emit('participantLeft', {
        participantId: client.userId,
        timestamp: new Date()
      });

      // Broadcast producer closed events before cleanup (use Promise.all to await all)
      const producerClosePromises = Object.entries(client.producer).map(async ([kind, producer]) => {
        if (producer) {
          await this.lockService.withLock(roomId, async () => {
            this.streamingGateway.broadcastToRoom(roomId, 'producerClosed', {
              producerId: producer.id,
              kind: kind
            });
          });
        }
      });
      await Promise.all(producerClosePromises);

      // Decrement worker transport count
      if (workerPid !== -1) {
        // Decrement for upstream transport
        if (client.upstreamTransport) this.workerManager.incTransports(workerPid, -1);
        // Decrement for downstream transports
        client.downstreamTransports.forEach(() => {
          this.workerManager.incTransports(workerPid, -1);
        });
      }

      // Leave socket room before cleanup
      socket.leave(roomId);

      // Cleanup client MediaSoup resources
      this.logger.log(`Cleaning up MediaSoup resources for ${client.userId}`);
      client.cleanup();

      // Remove client from room
      room.removeClient(client.socket.id);

      // If room is empty after removal, cleanup and remove
      if (room.clients.length === 0) {
        this.logger.log(`Room ${roomId} is empty, cleaning up`);
        
        // Clear STT transcriptions for the room
        try {
          this.sttService.clearRoomTranscriptions(roomId);
        } catch (error) {
          this.logger.error(`Failed to clear STT transcriptions for room ${roomId}:`, error);
        }
        
        // Decrement router count
        if (workerPid !== -1) {
          this.workerManager.incRouters(workerPid, -1);
        }
        this.roomService.removeRoom(roomId);
      }
    } else {
      // Just cleanup client if not in room
      client.cleanup();
    }
  }

  async handleJoinRoom(client: Client, data: JoinRoomData): Promise<JoinRoomResponse> {
    const { roomId, userName, password } = data;

    try {
      let isNewRoom = false;
      let requestedRoom : Room | undefined = this.roomService.getRoom(roomId);

      if (!requestedRoom) {
        isNewRoom = true;
        // Room doesn't exist - create it (user becomes owner)
        const workerRecord = this.workerManager.pickWorkerForRoom(roomId);

        const createRoomParams: CreateRoomParams = {
            roomId, ownerId: userName, worker: workerRecord.worker, password: password || ''
          }

        requestedRoom = this.roomService.createRoom(createRoomParams)
        await this.roomService.initializeRoom(requestedRoom, this.streamingGateway.server);
        // Create router for the room
        await requestedRoom.createRouter();

        // Increment router count for load balancing
        this.workerManager.incRouters(workerRecord.pid, +1);
      }

      // Check password if room has one (skip for owner on new room)
      if (!isNewRoom && requestedRoom.roomSecure.password && requestedRoom.roomSecure.password !== password) {
        return { error: 'Invalid room password' };
      }

      // Check if user is banned
      const isBanned = requestedRoom.roomSecure.blackList.some(
        (ban) => ban.userId === client.userId && ban.expiresAt > Date.now()
      );
      if (isBanned) {
        return { error: 'You are banned from this room' };
      }

      // Check if user already in room (rejoin)
      const existingClient = requestedRoom.getClientByUserId(client.userId);
      if (existingClient && existingClient.socket.id !== client.socket.id) {
        // Disconnect old socket
        existingClient.socket.disconnect(true);
        requestedRoom.removeClient(existingClient.socket.id);
      }

      // Add client to room
      client.room = requestedRoom;
      requestedRoom.addClient(client);

      // Broadcast new participant to existing clients
      if (!isNewRoom) {

        await this.lockService.withLock(roomId, async () => {
          this.streamingGateway.broadcastToRoom(roomId, 'newParticipant', {
            participantId: client.userId,
            displayName: client.displayName,
          });
        })
      }

      // Import config to get the max active speakers limit
      const audioPidsToCreate = client.room.activeSpeakerList.slice(0, appConfig.roomSettings.maxActiveSpeakers)
      const { videoPidsToCreate, associatedUsers } = SocketHelpersUtil.extractProducerInfo(
        client.room,
        audioPidsToCreate
      )

      return {
        routerRtpCapabilities: requestedRoom.router?.rtpCapabilities,
        newRoom: isNewRoom,
        audioPidsToCreate,
        videoPidsToCreate,
        associatedUsers,
      };
    } catch (error) {
      this.logger.error(`Error joining room: ${error}`);
      return { error: 'Failed to join room' };
    }
  }

  async handleRequestTransport(
    client: Client,
    transportRequest: TransportRequestDto
  ): Promise<any> {
    if (!client.room) throw new Error('Client not in a room');
    return this.transportService.handleTransportRequest(client, transportRequest);
  }

  async handleConnectTransport(
    client: Client,
    data: ConnectTransportData
  ): Promise<string> {
    return this.transportService.connectTransport(client, {
      type: data.type,
      dtlsParameters: data.dtlsParameters,
      audioPid: data.audioPid,
    });
  }

  async handleStartProducing(
    client: Client,
    data: StartProducingData
  ): Promise<any> {
    if (!client.room) throw new Error('Client not in a room');
    const producerId = await this.mediaService.startProducing(client, data);

    // START STT TRANSCRIPTION FOR AUDIO PRODUCERS
    if (data.kind === 'audio') {
      try {
        this.logger.log(`Starting STT for audio producer ${producerId} from ${client.userId}`);
        await this.sttService.startTranscription(client, producerId);
      } catch (error) {
        this.logger.error(`Failed to start STT for ${client.userId}:`, error);
        // Don't fail the entire producer creation if STT fails
      }
    }

    // Broadcast new producer to other clients in the room
    const newProducerData = {
      participantId: client.userId,
      displayName: client.displayName,
      kind: data.kind,
      producerId,
    };

    // Update active speakers for both audio and video producers (async for better performance)
    const newTransportsByPeer = await this.activeSpeakersService.updateActiveSpeakers(client.room)

    if (!this.streamingGateway.server || !client.room) throw new Error('Server not initialized or client not in a room');
    // Process socket emissions in parallel for better performance
    await this.lockService.withLock(client.room.roomId, async () => {
      await SocketHelpersUtil.emitNewProducersInParallel(this.streamingGateway.server, newTransportsByPeer, client.room!)
    })
    await this.lockService.withLock(client.room.roomId, async () => {
      this.streamingGateway.broadcastToRoom(client.room!.roomId, 'newProducer', newProducerData);
    })
    return { producerId, producerInfo: newProducerData };
  }

  async handleAudioChange(client: Client, typeOfChange: string): Promise<void> {
    if (!client.room) return;

    // Use MediaService for actual audio control
    this.mediaService.handleAudioChange(client, typeOfChange);
    await this.lockService.withLock(client.room.roomId, async () => {
      this.streamingGateway.broadcastToRoom(client.room!.roomId, 'audioChange', {
      participantId: client.userId,
      typeOfChange,
    });
    })
  }

  async handleConsumeMedia(
    client: Client,
    data: ConsumeMediaData
  ): Promise<any> {
    return this.mediaService.consumeMedia(client, data);
  }

  async handleUnpauseConsumer(
    client: Client,
    data: UnpauseConsumerData
  ): Promise<string> {
    return this.mediaService.unpauseConsumer(client, data);
  }

  async getRoomTranscriptions(roomId: string) {
    return this.sttService.getTranscriptions(roomId);
  }

  // --------------------------------------------------------
  // --------------------------------------------------------
  // --------------------------------------------------------
  // --------------------------------------------------------

  // async handleJoinRoomRequest(
  //   client: Client,
  //   data: JoinRoomData
  // ): Promise<JoinRoomResponse> {
  //   const { roomId, userId } = data;

  //   // Check if room exists
  //   const room = this.roomService.findRoom(roomId);

  //   if (!room) {
  //     // Room doesn't exist - create directly (user becomes owner)
  //     return this.handleJoinRoom(client, data);
  //   }

  //   // If user is the owner, join directly
  //   if (room.ownerId === userId) {
  //     return this.handleJoinRoom(client, data);
  //   }

  //   // Check if user is banned
  //   const isBanned = room.roomSecure.blackList.some(
  //     (ban) => ban.userId === userId && ban.expiresAt > Date.now()
  //   );
  //   if (isBanned) {
  //     return { error: 'You are banned from this room' };
  //   }

  //   // Check if already has pending request
  //   const existingRequest = room.getPendingRequestByUserId(userId);
  //   if (existingRequest) {
  //     return { pendingApproval: true, requestId: existingRequest.requestId };
  //   }

  //   // Create pending join request
  //   const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  //   room.addPendingRequest({
  //     requestId,
  //     userId,
  //     displayName: client.displayName,
  //     socketId: client.socket.id,
  //     timestamp: Date.now(),
  //   });

  //   // Notify room owner about the join request
  //   const ownerClient = room.getClientByUserId(room.ownerId);
  //   if (ownerClient) {
  //     ownerClient.socket.emit('joinRoomRequest', {
  //       requestId,
  //       odil: userId,
  //       displayName: client.displayName,
  //     });
  //   }

  //   return { pendingApproval: true, requestId };
  // }

  // async handleAcceptJoinRoom(
  //   client: Client,
  //   data: AcceptJoinRoomData
  // ): Promise<any> {
  //   if (!client.room) {
  //     return { error: 'Not in a room' };
  //   }

  //   if (client.room.ownerId !== client.userId) {
  //     return { error: 'Only room owner can accept requests' };
  //   }

  //   const request = client.room.getPendingRequest(data.requestId);
  //   if (!request) {
  //     return { error: 'Request not found' };
  //   }

  //   // Remove pending request
  //   client.room.removePendingRequest(data.requestId);

  //   // Notify the requesting user that they've been accepted
  //   this.emitToSocket(request.socketId, 'joinRoomAccepted', {
  //     roomId: client.room.roomId,
  //     routerRtpCapabilities: client.room.router?.rtpCapabilities,
  //   });

  //   return { success: true };
  // }

  // async handleRejectJoinRoom(
  //   client: Client,
  //   data: { requestId: string }
  // ): Promise<any> {
  //   if (!client.room) {
  //     return { error: 'Not in a room' };
  //   }

  //   if (client.room.ownerId !== client.userId) {
  //     return { error: 'Only room owner can reject requests' };
  //   }

  //   const request = client.room.getPendingRequest(data.requestId);
  //   if (!request) {
  //     return { error: 'Request not found' };
  //   }

  //   // Remove pending request
  //   client.room.removePendingRequest(data.requestId);

  //   // Notify the requesting user that they've been rejected
  //   this.emitToSocket(request.socketId, 'joinRoomRejected', {
  //     roomId: client.room.roomId,
  //     reason: 'Your request to join was rejected by the room owner',
  //   });

  //   return { success: true };
  // }

  // async handleKickOutRoom(
  //   client: Client,
  //   data: KickOutRoomData
  // ): Promise<any> {
  //   if (!client.room) {
  //     return { error: 'Not in a room' };
  //   }

  //   if (client.room.ownerId !== client.userId) {
  //     return { error: 'Only room owner can kick users' };
  //   }

  //   const targetClient = client.room.getClientByUserId(data.userId);
  //   if (!targetClient) {
  //     return { error: 'User not found in room' };
  //   }

  //   // Broadcast to room that user is being kicked
  //   this.broadcastToRoom(client.room.roomId, 'participantKicked', {
  //     odil: data.userId,
  //     kickedBy: client.userId,
  //   });

  //   // Notify and disconnect the target
  //   targetClient.socket.emit('kicked', {
  //     reason: 'You have been kicked from the room',
  //     roomId: client.room.roomId,
  //   });
  //   targetClient.socket.disconnect(true);

  //   return { success: true };
  // }

  // async handleBlockUser(
  //   client: Client,
  //   data: BlockUserData
  // ): Promise<any> {
  //   if (!client.room) {
  //     return { error: 'Not in a room' };
  //   }

  //   if (client.room.ownerId !== client.userId) {
  //     return { error: 'Only room owner can block users' };
  //   }

  //   // Add to blacklist
  //   const expiresAt = data.durationMs
  //     ? Date.now() + data.durationMs
  //     : Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year default

  //   client.room.roomSecure.blackList.push({
  //     userId: data.userId,
  //     expiresAt,
  //   });

  //   // Broadcast to room that user is being blocked
  //   this.broadcastToRoom(client.room.roomId, 'participantBlocked', {
  //     odil: data.userId,
  //     blockedBy: client.userId,
  //   });

  //   // Kick the user if currently in room
  //   const targetClient = client.room.getClientByUserId(data.userId);
  //   if (targetClient) {
  //     targetClient.socket.emit('blocked', {
  //       reason: 'You have been blocked from this room',
  //       roomId: client.room.roomId,
  //     });
  //     targetClient.socket.disconnect(true);
  //   }

  //   return { success: true };
  // }
}
