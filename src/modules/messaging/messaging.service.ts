import { Injectable, Module } from '@nestjs/common';
import { MessagingGateway } from './messaging.gateway';
import { QueueModule } from '../distributed-queue/queue.module';

@Injectable()
export class MessagingService {
  constructor(
    private readonly chatGateway: MessagingGateway,
    private readonly queueModule: QueueModule,
  ) {}
}
