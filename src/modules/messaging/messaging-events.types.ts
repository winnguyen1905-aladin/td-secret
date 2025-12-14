/**
 * Socket Events Type Definitions
 * Following naming convention: <domain>.<entity>.<action>[.<qualifier>]
 */

import { UUID } from "crypto";

// ============================================================
// Common Types
// ============================================================

export interface SocketResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface SignalTransportPayload {
  opkId: string;
  type: number; // CiphertextMessageType (PreKey or Whisper)
  body: string; // base64 encoded ciphertext
  registrationId?: number; // Sender's registration ID
  deviceId?: number; // Sender's device ID
  peerRegistrationId?: number; // Recipient's registration ID (for multi-device routing)
  peerDeviceId?: number; // Recipient's device ID (required for multi-device decryption)
  /** Message counter from Signal Protocol chain - for sequence tracking */
  counter?: number;
  /** Previous chain length - for detecting ratchet steps */
  previousCounter?: number;
}

export interface Message {
  senderId: string;
  id: string;
  timestamp: number;
  encryptedContent: SignalTransportPayload;
  metadata: Record<string, any>;
  jobId: string;
  merkleLeaf: MerkleLeaf;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'VIDEO' | 'AUDIO';
  mimeType: 'text/plain' | 'image/png' | 'image/jpeg' | 'image/gif' | 'audio/mpeg' | 'audio/mp3' | 'audio/mp4' | 'audio/wav' | 'video/mp4' | 'video/webm' | 'video/quicktime';
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  isPrivate: boolean;
  createdBy: string;
  createdAt: number;
  memberCount: number;
  settings?: Record<string, any>;
}

export interface User {
  id: string;
  name: string;
  email?: string;
  profilePicture?: string;
  status?: 'online' | 'offline' | 'away' | 'busy';
  lastActive?: Date;
}

export interface MerkleLeaf {
  v: number;              // Version: 1
  ptCommit: string;       // Step ①: Poseidon(plaintext, salt) as hex
  leafHash: string;       // Step ②: Poseidon(jobId, senderId, timestamp, ptCommit) as hex
  signature: string;      // Step ③: Ed25519 signature of leafHash as hex
  signerPublicKey: string; // Session public key for verification
  algorithm: "pos-b2b";   // Algorithm identifier: Poseidon + Blake2b
  walletCoseKey: string;
  delegationCert: string;
}

// ============================================================
// MESSAGE EVENTS (chat.message.*)
// ============================================================

// chat.message.send
export interface ChatMessageSendPayload {
  id: UUID
  roomId: string;
  encryptedContent: SignalTransportPayload;
  timestamp: number
  jobId: string; 
  merkleLeaf: MerkleLeaf;
  type: 'text' | 'file';
  mimeType: 'text/plain' | 'image/png' | 'image/jpeg' | 'image/gif' | 'audio/mpeg' | 'audio/mp3' | 'audio/mp4' | 'audio/wav' | 'video/mp4' | 'video/webm' | 'video/quicktime';
}

export interface ChatMessageSendResponse {
  success: boolean;
  messageId: string;
  timestamp: Date;
  message: string;
}

// chat.message.edit
export interface ChatMessageEditPayload {
  messageId: string;
  content: string;
}
export interface ChatMessageEditResponse {
  messageId: string;
  updatedAt: number;
}

// chat.message.delete
export interface ChatMessageDeletePayload {
  messageId: string;
}

// chat.message.react
export interface ChatMessageReactPayload {
  messageId: string;
  reaction: string;
}
export interface ChatMessageReactResponse {
  messageId: string;
  reaction: string;
}

// chat.message.typing
export interface ChatMessageTypingPayload {
  roomId: string;
  isTyping: boolean;
}

// chat.message.read
export interface ChatMessageReadPayload {
  messageId: string;
  roomId: string;
}

// chat.message.history.get
export interface ChatMessageHistoryGetPayload {
  roomId: string;
  limit?: number;
  offset?: number;
  before?: string;
}
export interface ChatMessageHistoryGetResponse {
  messages: Message[];
  hasMore: boolean;
  total: number;
}

// chat.message.search
export interface ChatMessageSearchPayload {
  query: string;
  roomId?: string;
  limit?: number;
}
export interface ChatMessageSearchResponse {
  messages: Message[];
  total: number;
}

// chat.message.pin
export interface ChatMessagePinPayload {
  messageId: string;
  roomId: string;
}

// chat.message.unpin
export interface ChatMessageUnpinPayload {
  messageId: string;
  roomId: string;
}

// chat.message.forward
export interface ChatMessageForwardPayload {
  messageId: string;
  targetRoomId: string;
}
export interface ChatMessageForwardResponse {
  newMessageId: string;
}

// chat.message.reply
export interface ChatMessageReplyPayload {
  messageId: string;
  content: string;
  roomId: string;
}
export interface ChatMessageReplyResponse {
  messageId: string;
  replyToId: string;
}

// ============================================================
// DIRECT MESSAGE EVENTS (chat.direct.*)
// ============================================================

// chat.direct.message.send
export interface ChatDirectMessageSendPayload {
  recipientId: string;
  content: string;
  type?: string;
}
export interface ChatDirectMessageSendResponse {
  messageId: string;
  conversationId: string;
}

// chat.direct.typing
export interface ChatDirectTypingPayload {
  recipientId: string;
  isTyping: boolean;
}

// chat.direct.read
export interface ChatDirectReadPayload {
  conversationId: string;
  messageId: string;
}

// chat.direct.history.get
export interface ChatDirectHistoryGetPayload {
  userId: string;
  limit?: number;
  offset?: number;
}
export interface ChatDirectHistoryGetResponse {
  messages: Message[];
  hasMore: boolean;
}

// ============================================================
// ROOM EVENTS (chat.room.*)
// ============================================================

// chat.room.create
export interface ChatRoomCreatePayload {
  name: string;
  description?: string;
  isPrivate?: boolean;
  members?: string[];
}
export interface ChatRoomCreateResponse {
  roomId: string;
  room: Room;
}

// chat.room.join
export interface ChatRoomJoinPayload {
  roomId: string;
  password?: string;
}
export interface ChatRoomJoinResponse {
  room: Room;
  members: User[];
}

// chat.room.leave
export interface ChatRoomLeavePayload {
  roomId: string;
}

// chat.room.list
export interface ChatRoomListPayload {
  filter?: string;
  limit?: number;
}
export interface ChatRoomListResponse {
  rooms: Room[];
  total: number;
}

// chat.room.members.get
export interface ChatRoomMembersGetPayload {
  roomId: string;
}
export interface ChatRoomMembersGetResponse {
  members: User[];
}

// chat.room.invite
export interface ChatRoomInvitePayload {
  roomId: string;
  userId: string;
}

// chat.room.settings.update
export interface ChatRoomSettingsUpdatePayload {
  roomId: string;
  settings: Record<string, any>;
}
export interface ChatRoomSettingsUpdateResponse {
  room: Room;
}

// chat.room.delete
export interface ChatRoomDeletePayload {
  roomId: string;
}

// chat.room.member.kick
export interface ChatRoomMemberKickPayload {
  roomId: string;
  userId: string;
}

// chat.room.member.ban
export interface ChatRoomMemberBanPayload {
  roomId: string;
  userId: string;
  reason?: string;
}

// chat.room.member.role.update
export interface ChatRoomMemberRoleUpdatePayload {
  roomId: string;
  userId: string;
  role: 'admin' | 'moderator' | 'member';
}

// ============================================================
// GLOBAL CHAT EVENTS (chat.global.*)
// ============================================================

// chat.global.message.send
export interface ChatGlobalMessageSendPayload {
  content: string;
  messageType?: string;
  timestamp: number;
}
export interface ChatGlobalMessageSendResponse {
  success: boolean;
  message: Message;
}

// chat.global.history.get
export interface ChatGlobalHistoryGetPayload {
  limit?: number;
  offset?: number;
}
export interface ChatGlobalHistoryGetResponse {
  messages: Message[];
  hasMore: boolean;
  total: number;
}

// chat.global.typing
export interface ChatGlobalTypingPayload {
  isTyping: boolean;
}

// ============================================================
// BOT COMMAND EVENTS (bot.command.*)
// ============================================================

export interface BotCommand {
  name: string;
  description: string;
  usage: string;
  category: string;
  examples?: string[];
}

// bot.command.execute
export interface BotCommandExecutePayload {
  command: string;
  args?: string[];
  roomId?: string;
}
export interface BotCommandExecuteResponse {
  result: any;
  responseId: string;
}

// bot.command.list
export interface BotCommandListPayload {
  category?: string;
}
export interface BotCommandListResponse {
  commands: BotCommand[];
}

// bot.command.help
export interface BotCommandHelpPayload {
  command: string;
}
export interface BotCommandHelpResponse {
  command: string;
  description: string;
  usage: string;
  examples: string[];
}

// bot.command.suggest
export interface BotCommandSuggestPayload {
  input: string;
}
export interface BotCommandSuggestResponse {
  suggestions: Array<{
    command: string;
    description: string;
  }>;
}

// ============================================================
// BOT RESPONSE EVENTS (bot.response.*)
// ============================================================

// bot.response.get
export interface BotResponseGetPayload {
  responseId: string;
}
export interface BotResponseGetResponse {
  response: any;
  timestamp: number;
}

// ============================================================
// BOT INTERACTION EVENTS (bot.interaction.*)
// ============================================================

// bot.interaction.button
export interface BotInteractionButtonPayload {
  messageId: string;
  buttonId: string;
  value?: any;
}
export interface BotInteractionButtonResponse {
  result: any;
}

// bot.interaction.menu
export interface BotInteractionMenuPayload {
  messageId: string;
  menuId: string;
  selectedOption: string;
}
export interface BotInteractionMenuResponse {
  result: any;
}

// ============================================================
// BOT SETTINGS EVENTS (bot.settings.*)
// ============================================================

// bot.settings.get
export interface BotSettingsGetPayload {
  botId?: string;
}
export interface BotSettingsGetResponse {
  settings: Record<string, any>;
}

// bot.settings.update
export interface BotSettingsUpdatePayload {
  botId: string;
  settings: Record<string, any>;
}
export interface BotSettingsUpdateResponse {
  settings: Record<string, any>;
}

// ============================================================
// SERVER EMITTED EVENTS
// ============================================================

// ============================================================
// SERVER EMITTED EVENT PAYLOADS
// ============================================================

// chat.message.new
export interface ServerEmittedMessageNew {
  message: Message;
}

// chat.message.updated
export interface ServerEmittedMessageUpdated {
  messageId: string;
  content: string;
  updatedAt: number;
}

// chat.message.deleted
export interface ServerEmittedMessageDeleted {
  messageId: string;
  roomId: string;
}

// chat.message.reaction.added
export interface ServerEmittedMessageReactionAdded {
  messageId: string;
  userId: string;
  reaction: string;
}

// chat.global.message.new
export interface ServerEmittedGlobalMessageNew {
  message: Message;
}

// chat.global.typing
export interface ServerEmittedGlobalTyping {
  userId: string;
  userName: string;
  isTyping: boolean;
}

// chat.direct.message.new
export interface ServerEmittedDirectMessageNew {
  message: Message;
  conversationId: string;
}

// chat.room.member.joined
export interface ServerEmittedRoomMemberJoined {
  roomId: string;
  user: User;
}

// chat.room.member.left
export interface ServerEmittedRoomMemberLeft {
  roomId: string;
  userId: string;
}

// bot.response.ready
export interface ServerEmittedBotResponseReady {
  responseId: string;
  response: any;
}

// bot.command.result
export interface ServerEmittedBotCommandResult {
  command: string;
  result: any;
  success: boolean;
}

// ============================================================
// EVENT NAME CONSTANTS
// ============================================================

export const SOCKET_EVENTS = {
  // Message events
  CHAT_MESSAGE_SEND: 'chat.message.send',
  CHAT_MESSAGE_EDIT: 'chat.message.edit',
  CHAT_MESSAGE_DELETE: 'chat.message.delete',
  CHAT_MESSAGE_REACT: 'chat.message.react',
  CHAT_MESSAGE_TYPING: 'chat.message.typing',
  CHAT_MESSAGE_READ: 'chat.message.read',
  CHAT_MESSAGE_HISTORY_GET: 'chat.message.history.get',
  CHAT_MESSAGE_SEARCH: 'chat.message.search',
  CHAT_MESSAGE_PIN: 'chat.message.pin',
  CHAT_MESSAGE_UNPIN: 'chat.message.unpin',
  CHAT_MESSAGE_FORWARD: 'chat.message.forward',
  CHAT_MESSAGE_REPLY: 'chat.message.reply',

  // Direct message events
  CHAT_DIRECT_MESSAGE_SEND: 'chat.direct.message.send',
  CHAT_DIRECT_TYPING: 'chat.direct.typing',
  CHAT_DIRECT_READ: 'chat.direct.read',
  CHAT_DIRECT_HISTORY_GET: 'chat.direct.history.get',

  // Room events
  CHAT_ROOM_CREATE: 'chat.room.create',
  CHAT_ROOM_JOIN: 'chat.room.join',
  CHAT_ROOM_LEAVE: 'chat.room.leave',
  CHAT_ROOM_LIST: 'chat.room.list',
  CHAT_ROOM_MEMBERS_GET: 'chat.room.members.get',
  CHAT_ROOM_INVITE: 'chat.room.invite',
  CHAT_ROOM_SETTINGS_UPDATE: 'chat.room.settings.update',
  CHAT_ROOM_DELETE: 'chat.room.delete',
  CHAT_ROOM_MEMBER_KICK: 'chat.room.member.kick',
  CHAT_ROOM_MEMBER_BAN: 'chat.room.member.ban',
  CHAT_ROOM_MEMBER_ROLE_UPDATE: 'chat.room.member.role.update',

  // Global chat events
  CHAT_GLOBAL_MESSAGE_SEND: 'chat.global.message.send',
  CHAT_GLOBAL_HISTORY_GET: 'chat.global.history.get',
  CHAT_GLOBAL_TYPING: 'chat.global.typing',

  // Bot command events
  BOT_COMMAND_EXECUTE: 'bot.command.execute',
  BOT_COMMAND_LIST: 'bot.command.list',
  BOT_COMMAND_HELP: 'bot.command.help',
  BOT_COMMAND_SUGGEST: 'bot.command.suggest',

  // Bot response events
  BOT_RESPONSE_GET: 'bot.response.get',

  // Bot interaction events
  BOT_INTERACTION_BUTTON: 'bot.interaction.button',
  BOT_INTERACTION_MENU: 'bot.interaction.menu',

  // Bot settings events
  BOT_SETTINGS_GET: 'bot.settings.get',
  BOT_SETTINGS_UPDATE: 'bot.settings.update',

  // Server emitted events
  CHAT_MESSAGE_NEW: 'chat.message.new',
  CHAT_MESSAGE_UPDATED: 'chat.message.updated',
  CHAT_MESSAGE_DELETED: 'chat.message.deleted',
  CHAT_MESSAGE_REACTION_ADDED: 'chat.message.reaction.added',
  CHAT_GLOBAL_MESSAGE_NEW: 'chat.global.message.new',
  CHAT_GLOBAL_TYPING_BROADCAST: 'chat.global.typing',
  CHAT_DIRECT_MESSAGE_NEW: 'chat.direct.message.new',
  CHAT_ROOM_MEMBER_JOINED: 'chat.room.member.joined',
  CHAT_ROOM_MEMBER_LEFT: 'chat.room.member.left',
  BOT_RESPONSE_READY: 'bot.response.ready',
  BOT_COMMAND_RESULT: 'bot.command.result',
} as const;

export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];

