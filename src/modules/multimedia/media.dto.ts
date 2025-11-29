import * as mediasoup from "mediasoup";

export enum StreamKind {
  Audio = "audio",
  Video = "video",
  Screen = "screen",
  ScreenAudio = "screenAudio",
  ScreenVideo = "screenVideo",
  AR = "ar",
  Drawing = "drawing",
  Detection = "detection",
}

export type AudioChangeType = "mute" | "unmute";

export interface StreamMetadata {
  source?: 'camera' | 'screen' | 'processed';
  processing?: 'ar' | 'detection' | 'drawing';
  quality?: 'low' | 'medium' | 'high';
  realTime?: boolean;
}

export interface StartProducingDto {
  kind: StreamKind;
  rtpParameters: mediasoup.types.RtpParameters;
  metadata?: StreamMetadata;
}

export interface ConsumeMediaDto {
  rtpCapabilities: mediasoup.types.RtpCapabilities;
  pid: string;
  kind: StreamKind;
}

export interface ConsumeResponseDto {
  producerId: string;
  id: string;
  kind: StreamKind;
  rtpParameters: mediasoup.types.RtpParameters;
}

export interface UnpauseConsumerDto {
  pid: string;
  kind: StreamKind;
}

export interface AudioChangeDto {
  typeOfChange: AudioChangeType;
}

export interface UserInfo {
  id: string;
  displayName: string;
}


export interface NewProducersToConsumeDto {
  audioPidsToCreate: string[];
  associatedUsers: UserInfo[];
  activeSpeakerList: string[];
  videoPidsToCreate: (string | null)[];
  routerRtpCapabilities: mediasoup.types.RtpCapabilities;
}
