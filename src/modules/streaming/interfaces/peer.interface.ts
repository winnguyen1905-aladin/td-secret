import { types as MediasoupTypes } from 'mediasoup';

export interface Peer {
  id: string;
  socketId: string;
  transports: Map<string, MediasoupTypes.WebRtcTransport>;
  producers: Map<string, MediasoupTypes.Producer>;
  consumers: Map<string, MediasoupTypes.Consumer>;
}
