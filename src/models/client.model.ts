import * as mediasoup from 'mediasoup';
import { Room } from './room.model';
import { TransportListenInfo } from 'mediasoup/node/lib/types';
import { StreamKind } from '@/modules/multimedia/media.dto';
import { AuthenticatedSocket } from '@/common/interfaces';
import { TransportRole } from '@/modules/streaming/interfaces/streaming-events.interface';
import { TransportParamsDto } from '@/modules/transport/transport.types';
import appConfig from '@/config/app.config';

export interface DownstreamTransport {
  transport: mediasoup.types.WebRtcTransport;

  // Legacy fields (keep for backward compatibility)
  associatedVideoPid: string | null;
  associatedAudioPid: string | null;

  // New flexible association
  associatedProducers?: Map<StreamKind, string>;
  consumers?: Map<StreamKind, mediasoup.types.Consumer>;

  // Dynamic access for consumers by stream type
  [key: string]: any;
}

export interface Producer {
  audio?: mediasoup.types.Producer;
  video?: mediasoup.types.Producer;
  screen?: mediasoup.types.Producer;
  ar?: mediasoup.types.Producer;
  drawing?: mediasoup.types.Producer;
  detection?: mediasoup.types.Producer;
  [key: string]: mediasoup.types.Producer | undefined;
}

export class Client {
  public userId: string;
  public displayName: string
  public producer: Producer = {};
  public room: Room | null = null;
  public socket: AuthenticatedSocket;
  public downstreamTransports: DownstreamTransport[] = [];
  public upstreamTransport: mediasoup.types.WebRtcTransport | null = null;

  constructor(userId: string, socket: AuthenticatedSocket, displayName?: string) {
    this.userId = userId;
    this.socket = socket;
    this.displayName = displayName || 'Anonymous';
  }

  async addTransport(
    type: TransportRole,
    streamKind?: StreamKind,
    associatedProducerId?: string,
    // Keep legacy params for backward compatibility
    audioPid: string | null = null,
    videoPid: string | null = null): Promise<TransportParamsDto> {
    const { listenIps, initialAvailableOutgoingBitrate, maxIncomingBitrate } = appConfig.webRtcTransport;
    const transport = await this.room?.router?.createWebRtcTransport({
      enableUdp: true,
      enableTcp: true, //always use UDP unless we can't
      preferUdp: true,
      listenInfos: listenIps as TransportListenInfo[],
      initialAvailableOutgoingBitrate,
    });

    if (maxIncomingBitrate) {
      try {
        await transport?.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (err) {
        console.log("Error setting bitrate", err);
      }
    }
    if (!transport) throw Error("Cannot create WebRtc transport for client " + this.userId);

    const clientTransportParams = {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };

    if (type === TransportRole.PRODUCER) this.upstreamTransport = transport;
    else if (type === TransportRole.CONSUMER) {
      const downstreamTransport: DownstreamTransport = {
        transport: transport,

        // Legacy support
        associatedVideoPid: videoPid,
        associatedAudioPid: audioPid,

        // New flexible association
        associatedProducers: new Map(),
        consumers: new Map(),
      };

      // Set associations based on parameters
      if (associatedProducerId && streamKind) {
        downstreamTransport.associatedProducers?.set(streamKind, associatedProducerId);
      }

      this.downstreamTransports.push(downstreamTransport);
    }

    return clientTransportParams;
  }

  addProducer(kind: StreamKind, newProducer: mediasoup.types.Producer): void {
    this.producer[kind] = newProducer;
    if (kind === StreamKind.Audio && this.room && this.room.activeSpeakerObserver) {
      this.room.activeSpeakerObserver.addProducer({
        producerId: newProducer.id
      });
    }
  }

  addConsumer(kind: string, newConsumer: mediasoup.types.Consumer, downstreamTransport: DownstreamTransport): void {
    downstreamTransport[kind] = newConsumer;
  }

  hasActiveProducers(): boolean {
    return Object.keys(this.producer).length > 0;
  }

  cleanup(): void {
    // Close all transports and producers/consumers
    if (this.upstreamTransport) {
      this.upstreamTransport.close();
    }

    this.downstreamTransports.forEach(dt => {
      dt.transport.close();
    });

    Object.values(this.producer).forEach((producer: mediasoup.types.Producer | undefined) => {
      if (producer) {
        producer.close();
      }
    });

    this.downstreamTransports = [];
    this.producer = {};
    this.upstreamTransport = null;
  }
}
