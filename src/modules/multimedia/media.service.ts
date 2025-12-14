import * as mediasoup from "mediasoup";
import { Server as SocketIOServer } from "socket.io";
import {
  StartProducingDto,
  ConsumeMediaDto,
  ConsumeResponseDto,
  UnpauseConsumerDto,
  AudioChangeDto,
  StreamKind,
} from "./media.dto";
import { Injectable, Logger } from "@nestjs/common";
import { Client, DownstreamTransport } from "@/models/client.model";

@Injectable()
export class MediaService {

  private readonly logger = new Logger(MediaService.name);

  constructor() {}

  async startProducing(client: Client, producingData: StartProducingDto): Promise<string> {
    try {
      const newProducer = await client.upstreamTransport?.produce({
        kind: this.mapStreamKindToMediaKind(producingData.kind),
        rtpParameters: producingData.rtpParameters,
      });
      if (!newProducer) throw new Error('Cannot create producer')

      client.addProducer(producingData.kind, newProducer);

      // Handle specific stream types
      await this.handleStreamTypeSpecifics(client, producingData.kind, newProducer);

      return newProducer.id;
    } catch (error) {
      this.logger.error("Error starting producer:", error);
      throw error;
    }
  }

  async consumeMedia(
    client: Client,
    data: ConsumeMediaDto,
  ): Promise<ConsumeResponseDto | string> {
    try {
      if (
        !client.room?.router?.canConsume({
          producerId: data.pid,
          rtpCapabilities: data.rtpCapabilities,
        })
      ) {
        return "cannotConsume";
      }

      // Detect actual producer kind by checking which client has this producer
      let actualKind: StreamKind = data.kind as StreamKind;
      const producerClient = client.room?.clients.find((c: Client) => {
        return Object.values(c.producer).some((p: any) => p?.id === data.pid);
      });

      if (producerClient) {
        // Find which property holds this producer
        for (const [key, producer] of Object.entries(producerClient.producer)) {
          if ((producer as any)?.id === data.pid) {
            actualKind = key as StreamKind;
            console.log(`Detected producer kind: ${actualKind} for pid: ${data.pid}`);
            break;
          }
        }
      }

      this.logger.log(`[consumeMedia] Looking for transport - actualKind: ${actualKind}, PID: ${data.pid}`);
      this.logger.log(`[consumeMedia] Available transports:`, client.downstreamTransports.map(t => ({
        audioPid: t.associatedAudioPid,
        videoPid: t.associatedVideoPid
      })));

      const downstreamTransport = client.downstreamTransports.find((t: DownstreamTransport) => {
        if (actualKind === "audio" || actualKind === "screenAudio") {
          const match = t.associatedAudioPid === data.pid;
          console.log(`[consumeMedia] Checking audio transport: ${t.associatedAudioPid} === ${data.pid} ? ${match}`);
          return match;
        } else if (actualKind === "video" || actualKind === "screenVideo") {
          const match = t.associatedVideoPid === data.pid;
          console.log(`[consumeMedia] Checking video transport: ${t.associatedVideoPid} === ${data.pid} ? ${match}`);
          return match;
        }
        return false;
      });

      if (!downstreamTransport) {
        console.error(`[consumeMedia] Transport not found. Kind: ${actualKind}, PID: ${data.pid}`);
        throw new Error("Downstream transport not found");
      }

      // OPTIMIZATION: Create consumer unpaused for lower latency
      // Instead of creating paused and requiring separate unpause call
      const newConsumer = await downstreamTransport.transport.consume({
        producerId: data.pid,
        rtpCapabilities: data.rtpCapabilities,
        paused: false, // CHANGED: Start unpaused for immediate media flow
      });

      client.addConsumer(actualKind, newConsumer, downstreamTransport);

      console.log(
        `Consumer created for ${actualKind} producer ${data.pid} - starting unpaused`,
      );

      return {
        id: newConsumer.id,
        producerId: data.pid,
        kind: newConsumer.kind as StreamKind,
        rtpParameters: newConsumer.rtpParameters,
      };
    } catch (error) {
      console.log("Error consuming media:", error);
      return "consumeFailed";
    }
  }

  async unpauseConsumer(
    client: Client,
    data: UnpauseConsumerDto,
  ): Promise<string> {
    try {
      // Detect actual producer kind by checking which client has this producer
      let actualKind: string = data.kind;
      const producerClient = client.room?.clients.find((c: Client) => {
        return Object.values(c.producer).some((p: any) => p?.id === data.pid);
      });

      if (producerClient) {
        // Find which property holds this producer
        for (const [key, producer] of Object.entries(producerClient.producer)) {
          if ((producer as any)?.id === data.pid) {
            actualKind = key;
            break;
          }
        }
      }

      const consumerToResume = client.downstreamTransports.find((t: DownstreamTransport) => {
        return t?.[actualKind]?.producerId === data.pid;
      });

      if (consumerToResume && consumerToResume[actualKind]) {
        await consumerToResume[actualKind]?.resume();
        return "success";
      } else {
        console.log(
          `Consumer not found for pid: ${data.pid}, actualKind: ${actualKind}`,
        );
        return "consumerNotFound";
      }
    } catch (error) {
      console.log("Error unpausing consumer:", error);
      return "error";
    }
  }

  handleAudioChange(client: Client, typeOfChange: string): void {
    if (typeOfChange === "mute") {
      client?.producer?.audio?.pause();
    } else {
      client?.producer?.audio?.resume();
    }
  }

  private mapStreamKindToMediaKind(streamKind: StreamKind): mediasoup.types.MediaKind {
    switch (streamKind) {
      case "audio":
      case "screenAudio":
        return "audio";
      case "video":
      case "screen":
      case "screenVideo":
      case "ar":
      case "drawing":
      case "detection":
        return "video";
      default:
        throw new Error(`Unsupported stream kind: ${streamKind}`);
    }
  }

  private async handleStreamTypeSpecifics(
    client: Client,
    streamKind: StreamKind,
    producer: mediasoup.types.Producer
  ): Promise<void> {
    switch (streamKind) {
      case "audio":
        client.room?.activeSpeakerList.push(producer.id);
        break;
      case "screenAudio":
        // Add screen audio to active speaker list so it can be consumed
        client.room?.activeSpeakerList.push(producer.id);
        break;
      // case "screen":
      //   // Screen sharing specific logic
      //   await this.screenSharingService.startScreenShare(client, producer.rtpParameters);
      //   break;
      // case "ar":
      // case "drawing":
      //   // AR/Drawing specific logic
      //   await this.arService.startARStream(client, producer.rtpParameters);
      //   break;
      // case "detection":
      //   // AI detection specific logic
      //   await this.detectionService.startDetectionStream(client, producer.rtpParameters);
      //   break;
    }
  }
}

// Singleton export removed - use DI container instead
