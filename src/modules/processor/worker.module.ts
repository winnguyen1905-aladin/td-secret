import { Global, Module } from '@nestjs/common';
import { WorkerManagerService } from './worker.service';

@Global()
@Module({
  providers: [WorkerManagerService],
  exports: [WorkerManagerService],
})
export class WorkerModule {}
