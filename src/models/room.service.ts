import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { Room, CreateRoomParams } from './room.model';
import { Client } from './client.model';
import { ActiveSpeakersService, NewTransportsByPeer } from '@/modules/multimedia/active-speakers.service';
import { DominantSpeakerService, DominantSpeakerInfo } from '@/modules/multimedia/dominant-speaker.service';
import { NewProducersToConsumeDto, UserInfo } from '@/modules/multimedia/media.dto';
import appConfig from '@/config/app.config';

@Injectable()
export class RoomService {

  private readonly logger = new Logger(RoomService.name);
  private rooms: Map<string, Room> = new Map();

  constructor(
    private readonly activeSpeakersService: ActiveSpeakersService,
    private readonly dominantSpeakerService: DominantSpeakerService,
  ) {}

  createRoom(params: CreateRoomParams): Room {
    const room = new Room(params.roomId, params.ownerId, params.worker, params.password);
    this.rooms.set(params.roomId, room);
    this.logger.log(`Room created: ${params.roomId}`);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  removeRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.cleanup();
      this.rooms.delete(roomId);
      this.logger.log(`Room removed: ${roomId}`);
      return true;
    }
    return false;
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  async initializeRoom(room: Room, io: SocketIOServer): Promise<void> {
    await room.createRouter();

    // Setup dominant speaker observer with injected service
    if (room.activeSpeakerObserver) {
      room.activeSpeakerObserver.on('dominantspeaker', async (ds: DominantSpeakerInfo) => {
        await this.dominantSpeakerService.handleNewDominantSpeaker(ds, room);
      });
    }

    // Start periodic refresh with injected service
    this.startPeriodicRefresh(room, io);
  }

  private startPeriodicRefresh(room: Room, io: SocketIOServer): void {
    room.startPeriodicRefreshWithService(async () => {
      if (room.clients.length > 0 && room.activeSpeakerList.length > 0) {
        try {
          const activeSpeakers = room.activeSpeakerList.slice(0, appConfig.roomSettings.maxActiveSpeakers);
          io.to(room.roomId).emit('updateActiveSpeakers', activeSpeakers);
          const newTransportsByPeer = await this.activeSpeakersService.updateActiveSpeakers(room);
          if (Object.keys(newTransportsByPeer).length > 0) {
            await this.emitNewProducers(room, io, newTransportsByPeer);
          }
        } catch (error) {
          this.logger.error(`Room ${room.roomId} periodic refresh error:`, error);
        }
      }
    });
  }

  private async emitNewProducers(room: Room, io: SocketIOServer, newTransportsByPeer: NewTransportsByPeer): Promise<void> {
    const emissionPromises = Object.entries(newTransportsByPeer).map(([socketId, audioPidsToCreate]) => {
      return new Promise<void>((resolve) => {
        const videoPidsToCreate = audioPidsToCreate.map((aPid: string) => {
          const producerClient = room.clients.find(
            (c: Client) => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid
          );
          if (producerClient?.producer?.screenAudio?.id === aPid) {
            return producerClient?.producer?.screenVideo?.id || null;
          }
          return producerClient?.producer?.video?.id || null;
        });

        const associatedUsers: UserInfo[] = audioPidsToCreate.map((aPid: string) => {
          const producerClient = room.clients.find(
            (c: Client) => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid
          );
          const isScreenShare = producerClient?.producer?.screenAudio?.id === aPid;
          const id = producerClient?.userId || 'unknown';
          const displayName = producerClient?.displayName || 'Unknown User';
          return {
            id: isScreenShare ? `${id}-screen` : id,
            displayName: isScreenShare ? `${displayName} (Sharing)` : displayName,
          };
        });

        const newProducersToConsume: NewProducersToConsumeDto = {
          routerRtpCapabilities: room.router!.rtpCapabilities,
          audioPidsToCreate,
          videoPidsToCreate,
          associatedUsers,
          activeSpeakerList: room.activeSpeakerList.slice(0, appConfig.roomSettings.maxActiveSpeakers),
        };

        io.to(socketId).emit('newProducersToConsume', newProducersToConsume);
        resolve();
      });
    });

    await Promise.all(emissionPromises);
  }
}
