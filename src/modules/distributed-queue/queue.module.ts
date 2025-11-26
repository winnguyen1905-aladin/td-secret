import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessageProducerService } from './message-producer.service';
import { NotificationConsumerService } from './message-consumer.service';
import { NotificationEmitterService } from './notification-emitter.service';
import { MessagingModule } from '../messaging';

@Module({
  imports: [
    forwardRef(() => MessagingModule),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD', ''),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'message-queue' },
      { name: 'streaming-queue' },
    ),
  ],
  providers: [
    MessageProducerService,
    NotificationEmitterService,
    NotificationConsumerService,
  ],
  exports: [
    MessageProducerService,
    NotificationEmitterService,
    NotificationConsumerService,
  ],
})
export class QueueModule {}
