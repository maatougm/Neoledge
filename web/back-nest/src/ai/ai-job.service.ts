/**
 * @file ai-job.service.ts — fire-and-forget job runner for slow AI calls.
 *
 * Long AI generations (backlog ~90s) ran as a single blocking HTTP request,
 * which feels broken and risks proxy/client timeouts. This runs the work in
 * the background and lets the client poll for the result — the request returns
 * a jobId immediately. In-memory + single-instance (jobs reset on restart);
 * good enough for interactive PM use, swap for a queue if we ever scale out.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

type JobStatus = 'pending' | 'done' | 'error';

interface Job {
  status: JobStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
}

@Injectable()
export class AiJobService {
  private readonly logger = new Logger(AiJobService.name);
  private readonly jobs = new Map<string, Job>();
  private readonly TTL_MS = 10 * 60 * 1000;

  /** Start `fn` in the background; returns a jobId to poll with `get()`. */
  start<T>(fn: () => Promise<T>): string {
    const id = randomUUID();
    const job: Job = { status: 'pending', createdAt: Date.now() };
    this.jobs.set(id, job);
    void fn().then(
      (result) => {
        job.status = 'done';
        job.result = result;
      },
      (e: unknown) => {
        job.status = 'error';
        job.error = e instanceof Error ? e.message : String(e);
        this.logger.warn(`AI job ${id} failed: ${job.error}`);
      },
    );
    this.sweep();
    return id;
  }

  get(id: string): { status: JobStatus; result?: unknown; error?: string } | null {
    const j = this.jobs.get(id);
    if (!j) return null;
    return { status: j.status, result: j.result, error: j.error };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.jobs) {
      if (now - v.createdAt > this.TTL_MS) this.jobs.delete(k);
    }
  }
}
