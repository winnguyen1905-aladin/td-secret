import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessageProducerService } from './message-producer.service';
import { NotificationConsumerService } from './message-consumer.service';

@Module({
  imports: [
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
    NotificationConsumerService,
  ],
  exports: [
    MessageProducerService,
    NotificationConsumerService,
  ],
})
export class QueueModule {}
