import { UserInfo } from "@/modules/multimedia/media.dto";
import * as mediasoup from "mediasoup";

export interface RoomDto {
  roomId: string;
  clientCount: number;
  activeSpeakers: string[];
}

export interface ClientDto {
  userId: string;
  socketId: string;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface ActiveSpeakersUpdateDto {
  activeSpeakerList: string[];
  audioPidsToCreate: string[];
  videoPidsToCreate: (string | null)[];
  associatedUsers: UserInfo[];
  routerRtpCapabilities?: mediasoup.types.RtpCapabilities;
}
