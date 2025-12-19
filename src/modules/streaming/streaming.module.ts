import { Module, forwardRef } from '@nestjs/common';
import { StreamingGateway } from './streaming.gateway';
import { StreamingService } from './streaming.service';
import { StreamingAudioCaptureService } from './streaming-audio-capture.service';
import { RedisModule } from '@/modules/distributed-cache/redis.module';
import { TransportModule } from '@/modules/transport/transport.module';
import { MediaModule } from '@/modules/multimedia/media.module';
import { WorkerModule } from '@/modules/processor/worker.module';
import { ModelsModule } from '@/models/models.module';

@Module({
  imports: [
    RedisModule,
    TransportModule,
    forwardRef(() => MediaModule),
    forwardRef(() => ModelsModule),
    WorkerModule,
  ],
  providers: [StreamingGateway, StreamingService, StreamingAudioCaptureService],
  exports: [StreamingGateway, StreamingService, StreamingAudioCaptureService],
})
export class StreamingModule {}