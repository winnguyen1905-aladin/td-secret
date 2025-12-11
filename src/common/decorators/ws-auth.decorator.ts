import { applyDecorators, UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../guards/ws-jwt.guard';

export function WsAuth() {
  return applyDecorators(UseGuards(WsJwtGuard));
}
