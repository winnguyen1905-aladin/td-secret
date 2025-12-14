import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { Server as SocketIOServer } from "socket.io";
import appConfig from "@/config/app.config";
import { Client } from "@/models/client.model";
import { Room } from "@/models/room.model";
import { StreamingGateway } from "../streaming/streaming.gateway";
import { DistributedLockService } from "../distributed-cache/distributed-lock.service";

export interface NewTransportsByPeer {
  [socketId: string]: string[];
}

@Injectable()
export class ActiveSpeakersService {
  private readonly logger = new Logger(ActiveSpeakersService.name);

  constructor(
    @Inject(forwardRef(() => StreamingGateway))
    private readonly streamingGateway: StreamingGateway,
    private readonly lockService: DistributedLockService
  ) {}

  async updateActiveSpeakers(
    updatedRoom: Room
  ): Promise<NewTransportsByPeer> {
    // Import config to get the max active speakers limit
    const maxActiveSpeakers = appConfig.roomSettings.maxActiveSpeakers;

    const activeSpeakers = updatedRoom.activeSpeakerList.slice(0, maxActiveSpeakers);
    const mutedSpeakers = updatedRoom.activeSpeakerList.slice(maxActiveSpeakers);
    const newTransportsByPeer: NewTransportsByPeer = {};

    // Reduced logging for better performance
    this.logger.debug(`Room: ${updatedRoom.roomId} > Clients: ${updatedRoom.clients.length} > Active: [${activeSpeakers.length}]`);

    // Process all clients in parallel for much better performance
    const clientProcessingPromises = updatedRoom.clients.map(async (client: Client, index) => {
    const newSpeakersToThisClient: string[] = [];

    try {
      // SMOOTH VIDEO OPTIMIZATION: Only pause/resume audio, avoid disrupting video streams
      const audioOperations: Promise<void>[] = [];

      // Helper to check if a consumer/producer is still valid (not closed)
      const isValidMediaObject = (obj: any): boolean => {
        return obj && !obj.closed;
      };

      // Mute speakers beyond max limit (AUDIO ONLY - don't interrupt video)
      mutedSpeakers.forEach((pid) => {
        if (client?.producer?.audio?.id === pid && isValidMediaObject(client?.producer?.audio)) {
          audioOperations.push(
            Promise.resolve().then(() => client?.producer?.audio?.pause()),
          );
          return;
        }

        const downstreamToStop = client.downstreamTransports.find(
          (t) => t?.audio?.producerId === pid,
        );
        if (downstreamToStop?.audio && isValidMediaObject(downstreamToStop.audio)) {
          audioOperations.push(
            Promise.resolve().then(() => downstreamToStop.audio?.pause()),
          );
        }
      });

      // Resume active speakers (AUDIO ONLY - let video run smoothly)
      activeSpeakers.forEach((pid) => {
        if (client?.producer?.audio?.id === pid && isValidMediaObject(client?.producer?.audio)) {
          audioOperations.push(
            Promise.resolve().then(() => client?.producer?.audio?.resume()),
          );
          return;
        }

        const downstreamToStart = client.downstreamTransports.find(
          (t) => t?.associatedAudioPid === pid,
        );
        if (downstreamToStart?.audio && isValidMediaObject(downstreamToStart.audio)) {
          audioOperations.push(
            Promise.resolve().then(() => downstreamToStart?.audio?.resume()),
          );
        } else if (!downstreamToStart?.audio) {
          // Only add to newSpeakersToThisClient if there's no consumer at all (not just closed)
          newSpeakersToThisClient.push(pid);
        }
      });

      // Execute all audio operations in parallel (without affecting video)
      if (audioOperations.length > 0) {
        await Promise.all(audioOperations);
      }

      // Handle video separately for smooth transitions - only resume, don't pause active video
      const videoResumePromises: Promise<void>[] = [];
      activeSpeakers.forEach((pid) => {
        if (client?.producer?.video?.id && client?.producer?.audio?.id === pid) {
          if (client.producer.video.paused && isValidMediaObject(client.producer.video)) {
            videoResumePromises.push(
              Promise.resolve().then(() => client?.producer?.video?.resume()),
            );
          }
          return;
        }

        const downstreamToStart = client.downstreamTransports.find(
          (t) => t?.associatedAudioPid === pid,
        );
        if (downstreamToStart?.video && downstreamToStart.video.paused && isValidMediaObject(downstreamToStart.video)) {
          videoResumePromises.push(
            Promise.resolve().then(() => downstreamToStart?.video?.resume()),
          );
        }
      });

      // Resume video streams without blocking
      if (videoResumePromises.length > 0) {
        Promise.all(videoResumePromises).catch((err) =>
          console.warn(`[ActiveSpeakers] Video resume warning for ${client.userId}:`, err),
        );
      }

      return {
        clientId: client.socket.id,
        newSpeakers: newSpeakersToThisClient,
      };
    } catch (error) {
      console.error(
        `[ActiveSpeakers] Error processing client ${client.userId}:`,
        error,
      );
      return {
        clientId: client.socket.id,
        newSpeakers: newSpeakersToThisClient,
      };
    }
    });

    // Wait for all clients to be processed in parallel
    const results = await Promise.all(clientProcessingPromises);

    // Build the result map
    results.forEach(({ clientId, newSpeakers }) => {
      if (newSpeakers.length) {
        newTransportsByPeer[clientId] = newSpeakers;
      }
    });

    this.logger.debug(`Processed ${updatedRoom.clients.length} clients > ${Object.keys(newTransportsByPeer).length} need new transports`);

    // Emit to all clients with minimal delay for smoother updates
    this.lockService.withLock(updatedRoom.roomId, async () => {
      this.streamingGateway.server.to(updatedRoom.roomId).emit("updateActiveSpeakers", activeSpeakers);
    })

    return newTransportsByPeer;
  }
};
