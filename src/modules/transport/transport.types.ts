import * as mediasoup from "mediasoup";
import { DtlsParameters, IceCandidate, IceParameters, SctpParameters } from "mediasoup/node/lib/types";
import { TransportRole } from "../streaming/interfaces/streaming-events.interface";
import { StreamKind } from "../multimedia/media.dto";

export interface TransportRequestDto {
  type: TransportRole;
  streamKind?: StreamKind;
  associatedProducerId?: string;
  audioPid?: string;
}

export interface TransportParamsDto {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  sctpParameters?: SctpParameters;
}

export interface ConnectTransportDto {
  dtlsParameters: mediasoup.types.DtlsParameters;
  type: TransportRole;
  streamKind?: StreamKind;
  associatedProducerId?: string;
  audioPid?: string | undefined;
}

export interface RestartIceDto {
  transportId: string;
}
