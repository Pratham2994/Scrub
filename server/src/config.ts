import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `server/src` in dev (tsx) and `server/dist` in a build - both are one level under `server/`. */
const repoRoot = path.resolve(here, '..', '..');

/**
 * Zero is a value, not an absence.
 *
 * This used to require a positive number, so setting a limit to 0 to switch it
 * off silently fell back to the default instead. That is the worst way for a
 * setting to behave: it looks applied and is not.
 */
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  /**
   * Loopback, always. The command bar is editable, so a bind on 0.0.0.0 would hand
   * arbitrary ffmpeg argv to anyone on the network. CLAUDE.md makes this
   * non-negotiable and nothing reads an env var to change it.
   */
  host: '127.0.0.1' as const,
  port: intFromEnv('SCRUB_PORT', 5174),

  /** Uploaded sources and encoded outputs. Gitignored; swept on a TTL. */
  tmpDir: process.env.SCRUB_TMP_DIR ?? path.join(repoRoot, '.tmp'),
  /** Video files are large and nobody comes back for yesterday's export. */
  tmpTtlMs: intFromEnv('SCRUB_TMP_TTL_MINUTES', 6 * 60) * 60_000,
  tmpSweepIntervalMs: intFromEnv('SCRUB_TMP_SWEEP_MINUTES', 15) * 60_000,
  /**
   * A ceiling as well as a clock.
   *
   * The TTL alone let one afternoon of ordinary use reach 2.8 GB, none of it old
   * enough to expire. Every upload and every run writes another file, so without
   * a limit Scrub can fill a disk while behaving exactly as designed.
   */
  tmpMaxBytes: intFromEnv('SCRUB_TMP_MAX_GB', 8) * 1024 * 1024 * 1024,
  /**
   * Nothing this new is ever evicted for space, whatever the total. It is almost
   * certainly the file on screen or the output of a run that just finished.
   */
  tmpMinAgeMs: intFromEnv('SCRUB_TMP_MIN_AGE_MINUTES', 10) * 60_000,

  /** 4 GiB. A phone's 4K clip clears a gigabyte without trying. */
  maxUploadBytes: intFromEnv('SCRUB_MAX_UPLOAD_MB', 4096) * 1024 * 1024,

  /** Vite dev server. In a build the client is same-origin and sends no Origin. */
  devClientOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'] as const,
} as const;

export type Config = typeof config;
