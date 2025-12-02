import { types as MediasoupTypes } from 'mediasoup';

export interface Room {
  id: string;
  router: MediasoupTypes.Router;
  peers: Map<string, string>;
  createdAt: Date;
}
