import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import appConfig from '@/config/app.config';
import { Room } from '@/models/room.model';
import { NewProducersToConsumeDto, UserInfo } from './media.dto';
import { ActiveSpeakersService, NewTransportsByPeer } from './active-speakers.service';
import { StreamingGateway } from '../streaming/streaming.gateway';
import { DistributedLockService } from '../distributed-cache/distributed-lock.service';

export interface DominantSpeakerInfo {
	producer: {
		id: string;
	};
}

@Injectable()
export class DominantSpeakerService {
	private readonly logger = new Logger(DominantSpeakerService.name);
	constructor(
		@Inject(forwardRef(() => StreamingGateway))
		private readonly streamingGateway: StreamingGateway,
		private readonly activeSpeakersService: ActiveSpeakersService,
		private readonly lockService: DistributedLockService
	) {}

	async handleNewDominantSpeaker(ds: DominantSpeakerInfo, room: Room): Promise<void> {
    const i = room.activeSpeakerList.findIndex(pid => pid === ds.producer.id);

    // Check if this is actually a meaningful change to avoid unnecessary updates
    const isAlreadyTopSpeaker = i === 0;
    if (isAlreadyTopSpeaker) {
      this.logger.log('[DominantSpeaker] Already top speaker, skipping update for smoother video');
      return; // No change needed, avoid disrupting video streams
    }

    if (i > -1) {
      const [pid] = room.activeSpeakerList.splice(i, 1);
      room.activeSpeakerList.unshift(pid);
    } else {
      room.activeSpeakerList.unshift(ds.producer.id);
    }

    // Import config to get the max active speakers limit
    const maxActiveSpeakers = appConfig.roomSettings.maxActiveSpeakers;

    // Use lightweight update process for smooth video
    const newTransportsByPeer: NewTransportsByPeer = await this.activeSpeakersService.updateActiveSpeakers(room);

    // Only process new transports if needed to minimize video interruptions
    if (Object.keys(newTransportsByPeer).length === 0) {
      this.logger.log('[DominantSpeaker] No new transports needed, sending lightweight update');
      // Just send the updated speaker list without heavy transport operations
      await this.lockService.withLock(room.roomId, async () => {
        this.streamingGateway.server.to(room.roomId).emit('updateActiveSpeakers', room.activeSpeakerList.slice(0, maxActiveSpeakers));
      });
      return;
    }

    // Process socket emissions with minimal delay for smooth operation
    const emissionPromises = Object.entries(newTransportsByPeer).map(([socketId, audioPidsToCreate]) => {
      return new Promise<void>((resolve) => {
        const videoPidsToCreate: (string | null)[] = audioPidsToCreate.map(aPid => {
          const producerClient = room.clients.find(c => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid);
          if (producerClient?.producer?.screenAudio?.id === aPid) {
            return producerClient?.producer?.screenVideo?.id || null;
          }
          return producerClient?.producer?.video?.id || null;
        });

        const associatedUsers: UserInfo[] = audioPidsToCreate.map(aPid => {
          const producerClient = room.clients.find(c => c?.producer?.audio?.id === aPid || c?.producer?.screenAudio?.id === aPid);
          const isScreenShare = producerClient?.producer?.screenAudio?.id === aPid;
          const id = producerClient?.userId || 'unknown';
          const displayName = producerClient?.displayName || 'Unknown User';
          return {
            id: isScreenShare ? `${id}-screen` : id,
            displayName: isScreenShare ? `${displayName} (Sharing)` : displayName
          };
        });

        const newProducersToConsume: NewProducersToConsumeDto = {
          routerRtpCapabilities: room.router!.rtpCapabilities,
          audioPidsToCreate,
          videoPidsToCreate,
          associatedUsers,
          activeSpeakerList: room.activeSpeakerList.slice(0, maxActiveSpeakers)
        }

        this.lockService.withLock(room.roomId, async () => {
          this.streamingGateway.server.to(socketId).emit('newProducersToConsume', newProducersToConsume);
        });

        resolve();
      });
    });

    // Process all emissions efficiently
    await Promise.all(emissionPromises);

    this.logger.log(`[DominantSpeaker] Smoothly notified ${emissionPromises.length} clients of new producers`);
	}
}
