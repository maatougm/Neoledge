/**
 * @file error-tracker.ts — in-process ring buffer of recent server errors.
 *
 * App errors are logged to stdout (pino) but not stored, so the admin system
 * dashboard had no real "errors" signal. This keeps the last N 5xx errors +
 * a since-boot counter in memory so SystemStatus can surface them. Single
 * instance only (resets on restart) — that's fine for a live monitoring view
 * ("erreurs depuis le démarrage"); persistence to a table can come later.
 */

export interface TrackedError {
  message: string;
  status: number;
  method: string;
  path: string;
  name: string;
  at: string; // ISO timestamp
}

const RING_MAX = 50;
const ring: TrackedError[] = [];
let totalSinceBoot = 0;

export const ErrorTracker = {
  record(e: Omit<TrackedError, 'at'>): void {
    totalSinceBoot += 1;
    ring.push({ ...e, at: new Date().toISOString() });
    if (ring.length > RING_MAX) ring.shift();
  },

  snapshot(): { totalSinceBoot: number; recentCount: number; recent: TrackedError[] } {
    return {
      totalSinceBoot,
      recentCount: ring.length,
      // newest first, capped for the dashboard
      recent: ring.slice(-10).reverse(),
    };
  },
};
