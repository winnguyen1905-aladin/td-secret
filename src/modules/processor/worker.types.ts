import * as mediasoup from 'mediasoup';

type Worker = mediasoup.types.Worker;
type WorkerLogTag = mediasoup.types.WorkerLogTag;

export interface WorkerManagerOptions {
  // desired number of workers; defaults to logical CPU count, but can be reduced
  workerCount?: number;
  // interval for sampling metrics
  sampleIntervalMs?: number; // default 2000
  // threshold score considered as overloaded
  overloadScoreThreshold?: number; // default 1.2
  // score weights
  weightCpu?: number;      // default 1.0
  weightRouters?: number;  // default 0.02
  weightTransports?: number; // default 0.01

  rtcMinPort: number;
  rtcMaxPort: number;
  logLevel: mediasoup.types.WorkerSettings['logLevel'];
  logTags: WorkerLogTag[];
  // strategy when worker dies: 'respawn' or 'exit'
  onWorkerDied?: 'respawn' | 'exit';
}

export interface UsageSample {
  cpuTime: number; // ru_utime + ru_stime (mediasoup units, only difference matters)
  at: number;      // ms
}

export interface WorkerRecord {
  // index
  id: number;            
  worker: Worker;
  pid: number;
  online: boolean;

  // runtime stats
  last?: UsageSample;
  cpuPercent?: number;   // 0..N logical CPU
  score?: number;

  // load counters for score calculation (updated by app when creating/deleting)
  routers: number;
  transports: number;
}
