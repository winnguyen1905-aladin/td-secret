import { UserInfo } from "@/modules/multimedia/media.dto";

export interface JoinRoomDto {
  userId: string;
  roomId: string;
}

export interface JoinRoomResponseDto {
  routerRtpCapabilities: any;
  newRoom: boolean;
  audioPidsToCreate: string[];
  videoPidsToCreate: (string | null)[];
  associatedUsers: UserInfo[];
}
