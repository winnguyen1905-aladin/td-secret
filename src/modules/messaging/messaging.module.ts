import { Module } from '@nestjs/common';
import { ChatGateway } from './messaging.gateway';
import { QueueModule } from '../distributed-queue/queue.module';

@Module({
  imports: [QueueModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class MessagingModule {}
