import { Module, forwardRef } from '@nestjs/common';
import { RoomService } from './room.service';
import { MediaModule } from '@/modules/multimedia/media.module';
import { StreamingModule } from '@/modules/streaming/streaming.module';

@Module({
  imports: [forwardRef(() => MediaModule), forwardRef(() => StreamingModule)],
  providers: [RoomService],
  exports: [RoomService],
})
export class ModelsModule {}
