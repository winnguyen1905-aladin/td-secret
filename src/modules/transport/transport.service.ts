import {
  TransportRequestDto,
  TransportParamsDto,
  ConnectTransportDto,
} from "../transport/transport.types";
import { Injectable } from "@nestjs/common";
import { StreamKind } from "../multimedia/media.dto";
import { Client, DownstreamTransport } from "@/models/client.model";
import { TransportRole } from "../streaming/interfaces/streaming-events.interface";
import { WorkerManagerService } from "../processor/worker.service";

@Injectable()
export class TransportService {

  constructor(private readonly workerManager: WorkerManagerService) {}

  async handleTransportRequest(
    client: Client,
    transportRequest: TransportRequestDto
  ): Promise<TransportParamsDto> {
    let clientTransportParams: TransportParamsDto | undefined;

    if (transportRequest.type === TransportRole.PRODUCER) {
      // Check if producer transport already exists
      if (client.upstreamTransport && !client.upstreamTransport.closed) {
        return {
          id: client.upstreamTransport.id,
          iceParameters: client.upstreamTransport.iceParameters,
          iceCandidates: client.upstreamTransport.iceCandidates,
          dtlsParameters: client.upstreamTransport.dtlsParameters,
        };
      }
      clientTransportParams = await client.addTransport(transportRequest.type);
    } else if (transportRequest.type === TransportRole.CONSUMER) {
      const audioPid = transportRequest.audioPid;
      const videoPid = this.findVideoPid(client, transportRequest.audioPid);

      // Check if consumer transport for this audioPid already exists
      const existingTransport = client.downstreamTransports.find(
        (t: DownstreamTransport) => t.associatedAudioPid === audioPid && !t.transport.closed);

      if (existingTransport) {
        return {
          id: existingTransport.transport.id,
          iceParameters: existingTransport.transport.iceParameters,
          iceCandidates: existingTransport.transport.iceCandidates,
          dtlsParameters: existingTransport.transport.dtlsParameters,
        };
      }

      // Enhanced logic for different stream types
      const { associatedProducerId, streamKind } =
        this.resolveProducerAssociation(client, transportRequest );

      clientTransportParams = await client.addTransport(
        transportRequest.type,
        streamKind,
        associatedProducerId,
        audioPid, // Legacy support
        videoPid // Legacy support
      );
    }

    // IMPORTANT: Increment transport count for load balancing (only for NEW transports)
    if (clientTransportParams && client.room && client.room.worker) {
      const workerPid = (client.room.worker as any)._child?.pid ?? -1;
      if (workerPid !== -1) {
        this.workerManager.incTransports(workerPid, +1);
      }
    }

    return clientTransportParams as TransportParamsDto;
  }

  async connectTransport(
    client: Client,
    connectData: ConnectTransportDto,
  ): Promise<string> {
    try {
      if (connectData.type === TransportRole.PRODUCER) {
        const transport = client.upstreamTransport;
        if (!transport) {
          throw new Error("Upstream transport not found");
        }

        // Skip if already connected (prevent duplicate connect calls)
        if (transport.dtlsState === 'connected' || transport.dtlsState === 'connecting') {
          console.log(`[TransportService] Producer transport already ${transport.dtlsState}, skipping connect`);
          return "success";
        }

        await transport.connect({
          dtlsParameters: connectData.dtlsParameters,
        });
        return "success";
      } else if (connectData.type === TransportRole.CONSUMER) {
        const downstreamTransport = client.downstreamTransports.find(
          (t: DownstreamTransport) => {
            return t.associatedAudioPid === connectData.audioPid;
          },
        );

        if (downstreamTransport) {
          const transport = downstreamTransport.transport;

          // Skip if already connected (prevent duplicate connect calls)
          if (transport.dtlsState === 'connected' || transport.dtlsState === 'connecting') {
            console.log(`[TransportService] Consumer transport already ${transport.dtlsState}, skipping connect`);
            return "success";
          }

          await transport.connect({
            dtlsParameters: connectData.dtlsParameters
          });
          return "success";
        } else {
          throw new Error("Downstream transport not found");
        }
      }
      throw new Error("Invalid transport type");
    } catch (error) {
      console.log("Transport connection error:", error);
      throw error;
    }
  }

  private resolveProducerAssociation(
    client: Client,
    request: TransportRequestDto
  ): { associatedProducerId?: string; streamKind?: StreamKind } {
    if (request.associatedProducerId && request.streamKind) {
      return {
        associatedProducerId: request.associatedProducerId,
        streamKind: request.streamKind
      };
    }

    // Legacy fallback
    if (request.audioPid) {
      return {
        associatedProducerId: request.audioPid,
        streamKind: StreamKind.Audio
      };
    }

    return {};
  }

  private findVideoPid(client: Client, audioPid?: string): string | null {
    if (!audioPid || !client.room) return null;

    // Find the client that has this audio producer (regular or screen share)
    const producingClient = client.room.clients.find(
      (c: Client) => c.producer.audio?.id === audioPid || c.producer.screenAudio?.id === audioPid
    );

    if (!producingClient) return null;

    // Check if it's a screen share audio producer
    if (producingClient.producer.screenAudio?.id === audioPid) {
      return producingClient.producer.screenVideo?.id || null;
    }

    // Regular video producer
    return producingClient.producer.video?.id || null;
  }
}
