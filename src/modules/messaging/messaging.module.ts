import { forwardRef, Module } from '@nestjs/common';
import { MessagingGateway } from './messaging.gateway';
import { QueueModule } from '../distributed-queue/queue.module';

@Module({
  imports: [forwardRef(() => QueueModule)],
  providers: [MessagingGateway],
  exports: [MessagingGateway],
})
export class MessagingModule {}
