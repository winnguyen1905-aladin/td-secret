import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreModule } from './common/core.module';
import { AuthModule } from './modules/auth/auth.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { StreamingModule } from './modules/streaming/streaming.module';
import { QueueModule } from './modules/distributed-queue/queue.module';
import { RedisModule } from './modules/distributed-cache/redis.module';
import { WorkerModule } from './modules/processor/worker.module';
import { TransportModule } from './modules/transport/transport.module';
import { MediaModule } from './modules/multimedia/media.module';
import { ModelsModule } from './models/models.module';
import { TranscriptModule } from './modules/transcript/transcript.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CoreModule,
    RedisModule,
    WorkerModule,
    TransportModule,
    MediaModule,
    ModelsModule,
    QueueModule,
    AuthModule,
    MessagingModule,
    StreamingModule,
    TranscriptModule,
  ],
})
export class AppModule {}
