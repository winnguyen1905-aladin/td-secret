import { Module, forwardRef } from '@nestjs/common';
import { MediaService } from './media.service';
import { ActiveSpeakersService } from './active-speakers.service';
import { DominantSpeakerService } from './dominant-speaker.service';
import { StreamingModule } from '../streaming/streaming.module';

@Module({
  imports: [
    forwardRef(() => StreamingModule),
  ],
  providers: [MediaService, ActiveSpeakersService, DominantSpeakerService],
  exports: [MediaService, ActiveSpeakersService, DominantSpeakerService],
})
export class MediaModule {}
