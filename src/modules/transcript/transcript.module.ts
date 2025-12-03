import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TranscriptService } from './transcript.service';
import { TranscriptController } from './transcript.controller';

@Module({
  imports: [ConfigModule],
  controllers: [TranscriptController],
  providers: [TranscriptService],
  exports: [TranscriptService],
})
export class TranscriptModule {}
