import * as os from 'os';
import * as mediasoup from 'mediasoup';

import { setTimeout as delay } from 'timers/promises';
import { WorkerManagerOptions, WorkerRecord } from './worker.types';
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import appConfig from '@/config/app.config';

@Injectable()
export class WorkerManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerManagerService.name);
  private timer?: NodeJS.Timeout;
  private workers: WorkerRecord[] = [];
  private opts: Required<WorkerManagerOptions>;

  constructor() {
    const cpuCount = os.cpus().length;
    const workerSettings = appConfig.workerSettings;

    this.opts = {
      workerCount: cpuCount,
      sampleIntervalMs: 1000, // Reduced from 2000ms for faster load balancing response
      overloadScoreThreshold: 0.8, // Reduced from 1.2 for earlier load distribution
      weightCpu: 0.8, // Reduced CPU weight for smoother transitions
      weightRouters: 0.015, // Reduced router weight
      weightTransports: 0.01, // Reduced transport weight
      rtcMinPort: workerSettings.rtcMinPort,
      rtcMaxPort: workerSettings.rtcMaxPort,
      logLevel: workerSettings.logLevel,
      logTags: workerSettings.logTags as mediasoup.types.WorkerLogTag[],
      onWorkerDied: 'respawn',
    };
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing mediasoup workers...');
    try {
      await this.start();
      this.logger.log(`Started ${this.workers.length} mediasoup workers`);
    } catch (error) {
      this.logger.error('Failed to start mediasoup workers:', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down mediasoup workers...');
    await this.stop();
    this.logger.log('Mediasoup workers shutdown complete');
  }

  /** Khởi tạo N workers và bắt đầu sampling định kỳ */
  async start(): Promise<void> {
    const n = Math.max(1, this.opts.workerCount);
    for (let i = 0; i < n; i++) {
      await this.spawnWorker(i);
    }
    this.timer = setInterval(() => {
      this.sampleAll().catch(() => { });
    }, this.opts.sampleIntervalMs);
    // lấy 1 lần ngay lập tức để có số liệu sớm
    await this.sampleAll().catch(() => { });
  }

  /** Đóng tất cả workers và dừng sampling */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const closes = this.workers.map(w => Promise.resolve(w.worker.close()).catch(() => { }));
    await Promise.allSettled(closes);
    this.workers = [];
  }

  /** App nên gọi khi tạo/xoá router/transport để cập nhật điểm số */
  incRouters(workerPid: number, delta = 1) {
    const w = this.byPid(workerPid);
    if (w) w.routers = Math.max(0, w.routers + delta);
  }
  incTransports(workerPid: number, delta = 1) {
    const w = this.byPid(workerPid);
    if (w) w.transports = Math.max(0, w.transports + delta);
  }

  /** Lấy danh sách workers (read-only) */
  list(): ReadonlyArray<WorkerRecord> {
    return this.workers;
  }

  /** Chọn worker theo roomId (sticky) + failover nếu quá tải/offline */
  pickWorkerForRoom(roomId: string): WorkerRecord {
    const live = this.workers.filter(w => w.online);
    if (live.length === 0) throw new Error('No mediasoup workers available');

    const idx = this.hash32(roomId) % live.length;
    let chosen = live[idx];

    if (this.isOverloaded(chosen)) {
      // fallback: chọn worker có score thấp nhất
      chosen = this.leastLoaded(live);
    }
    return chosen;
  }

  /** Chọn worker ít tải nhất (không theo room) */
  pickLeastLoaded(): WorkerRecord {
    const live = this.workers.filter(w => w.online);
    if (live.length === 0) throw new Error('No mediasoup workers available');
    return this.leastLoaded(live);
  }

  /** Get system statistics for monitoring */
  getStats() {
    const live = this.workers.filter(w => w.online);
    const dead = this.workers.filter(w => !w.online);

    const totalRouters = this.workers.reduce((sum, w) => sum + w.routers, 0);
    const totalTransports = this.workers.reduce((sum, w) => sum + w.transports, 0);

    return {
      totalWorkers: this.workers.length,
      liveWorkers: live.length,
      deadWorkers: dead.length,
      totalRouters,
      totalTransports,
      workers: this.workers.map(w => ({
        id: w.id,
        pid: w.pid,
        online: w.online,
        routers: w.routers,
        transports: w.transports,
        cpuPercent: w.cpuPercent,
        score: w.score,
        isOverloaded: this.isOverloaded(w)
      }))
    };
  }

  // ---------- Internal ----------

  private async spawnWorker(slot: number) {
    const worker = await mediasoup.createWorker({
      rtcMinPort: this.opts.rtcMinPort,
      rtcMaxPort: this.opts.rtcMaxPort,
      logLevel: this.opts.logLevel || 'warn',
      logTags: this.opts.logTags,
    });

    const rec: WorkerRecord = {
      id: slot,
      worker,
      pid: (worker as any)._child?.pid ?? -1, // mediasoup không expose pid trực tiếp
      online: true,
      routers: 0,
      transports: 0,
    };

    worker.on('died', async () => {
      console.error(`[mediasoup] worker(pid=${rec.pid}) died`);
      rec.online = false;

      if (this.opts.onWorkerDied === 'exit') {
        // để process manager (pm2/k8s) restart nguyên pod/service
        process.exit(1);
      } else {
        // respawn chỉ worker đó
        try {
          await this.respawn(slot);
        } catch (e) {
          console.error('[mediasoup] failed to respawn worker:', e);
        }
      }
    });

    this.workers[slot] = rec;
  }

  private async respawn(slot: number) {
    // đợi 200ms cho hệ thống release tài nguyên (reduced for faster recovery)
    await delay(200);
    await this.spawnWorker(slot);
    // sample ngay để có số liệu mới
    await this.sampleOne(this.workers[slot]).catch(() => { });
    console.log(`[mediasoup] worker respawned at slot ${slot}`);
  }

  private byPid(pid: number): WorkerRecord | undefined {
    return this.workers.find(w => w.pid === pid);
  }

  private isOverloaded(w: WorkerRecord): boolean {
    const s = w.score ?? 0;
    return s >= this.opts.overloadScoreThreshold || !w.online;
    // overloadScoreThreshold có thể tinh chỉnh theo hệ thống
  }

  private leastLoaded(arr: WorkerRecord[]): WorkerRecord {
    return arr.reduce((best, cur) => {
      const bs = best.score ?? Infinity;
      const cs = cur.score ?? Infinity;
      return cs < bs ? cur : best;
    });
  }

  private async sampleAll() {
    await Promise.allSettled(this.workers.map(w => this.sampleOne(w)));
  }

  private async sampleOne(w: WorkerRecord) {
    if (!w.online) return;

    try {
      const usage = await w.worker.getResourceUsage();
      const now = Date.now();
      const cpuTime = (usage.ru_utime ?? 0) + (usage.ru_stime ?? 0);

      if (w.last) {
        const dt = Math.max(1, now - w.last.at); // ms
        const dCpu = Math.max(0, cpuTime - w.last.cpuTime);

        // cpuPercent ~ tỷ lệ CPU so với 1 core (đơn vị không tuyệt đối; chỉ tương đối theo dt)
        // do mediasoup units phụ thuộc nền tảng, ta chuẩn hoá theo dt để có "tương đối"
        const cpuPercent = dCpu / dt; // càng lớn càng nặng
        w.cpuPercent = cpuPercent;

        // điểm tổng hợp
        const score =
          (this.opts.weightCpu * cpuPercent) +
          (this.opts.weightRouters * w.routers) +
          (this.opts.weightTransports * w.transports);

        w.score = score;
      }

      w.last = { cpuTime, at: now };
    } catch (e) {
      // nếu sample lỗi, tạm set điểm cao để tránh chọn
      w.score = Number.POSITIVE_INFINITY;
    }
  }

  private hash32(str: string): number {
    // Fowler–Noll–Vo (FNV-1a) 32-bit (đủ nhanh & ổn định)
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // trả về số dương
    return (h >>> 0);
  }
}

// Backward compatibility export
export { WorkerManagerService as WorkerManager };
