import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';

/**
 * Parameter decorator to extract the current authenticated user from WebSocket context.
 * Works with both HTTP and WebSocket contexts.
 *
 * Usage:
 * ```typescript
 * @SubscribeMessage('event')
 * handleEvent(@CurrentUser() user: JwtUser) { ... }
 * ```
 */
export const AccountRequest = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const type = ctx.getType();

    if (type === 'ws') {
      const client = ctx.switchToWs().getClient<Socket>();
      const user = (client as any).userInfo || client.data?.user;
      return data ? user?.[data] : user;
    }

    // HTTP context fallback
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
