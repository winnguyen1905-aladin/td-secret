import { Injectable, Module } from '@nestjs/common';
import { ChatGateway } from './messaging.gateway';
import { QueueModule } from '../distributed-queue/queue.module';

@Injectable()
export class MessagingService {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly queueModule: QueueModule,
  ) {}
}
