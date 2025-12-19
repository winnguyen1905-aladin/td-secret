import { Module } from '@nestjs/common';
import { TransportService } from './transport.service';
import { WorkerModule } from '../processor/worker.module';

@Module({
  imports: [WorkerModule],
  providers: [TransportService],
  exports: [TransportService],
})
export class TransportModule {}