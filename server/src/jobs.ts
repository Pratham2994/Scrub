import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import type { CommandPlan } from '@scrub/shared';

import { applyMeasurement, type LoudnormMeasurement, parseLoudnorm } from './ffmpeg/loudnorm.js';
import type { FfmpegTool } from './ffmpeg/locate.js';
import { putFile } from './store.js';

export type JobEvent =
  | {
      readonly type: 'progress';
      readonly progress: number;
      readonly passIndex: number;
      readonly passCount: number;
      readonly passLabel: string;
      readonly elapsedMs: number;
    }
  | {
      readonly type: 'done';
      readonly outputId: string;
      readonly outputName: string;
      readonly sizeBytes: number;
      readonly elapsedMs: number;
    }
  | {
      readonly type: 'error';
      readonly message: string;
      /** ffmpeg's own last words. This audience can read them. */
      readonly detail: readonly string[];
    }
  | { readonly type: 'cancelled' };

type Subscriber = (event: JobEvent) => void;

type Job = {
  readonly id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /**
   * Replayed to a subscriber that attaches late. POST /run and the EventSource
   * that follows it are two round trips, and a short encode can finish inside
   * that gap — without replay the UI would wait forever for an event that has
   * already been and gone.
   */
  history: JobEvent[];
  subscribers: Set<Subscriber>;
  child: ChildProcess | null;
  cancelled: boolean;
};

const jobs = new Map<string, Job>();

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export function subscribe(job: Job, subscriber: Subscriber): () => void {
  for (const event of job.history) subscriber(event);
  if (job.status !== 'running') return () => undefined;
  job.subscribers.add(subscriber);
  return () => job.subscribers.delete(subscriber);
}

export function cancelJob(job: Job): boolean {
  if (job.status !== 'running') return false;
  job.cancelled = true;
  job.child?.kill();
  return true;
}

function emit(job: Job, event: JobEvent): void {
  // Progress is high-frequency and only the latest matters; terminal events are
  // kept so a late subscriber still learns how it ended.
  if (event.type === 'progress') {
    job.history = [...job.history.filter((e) => e.type !== 'progress'), event];
  } else {
    job.history = [...job.history, event];
  }
  for (const subscriber of job.subscribers) subscriber(event);
}

export type StartJobOptions = {
  readonly ffmpeg: FfmpegTool;
  readonly plan: CommandPlan;
  readonly outputPath: string;
  readonly outputName: string;
};

/** Starts the plan and returns immediately; progress arrives over the job's events. */
export function startJob(options: StartJobOptions): string {
  const id = randomUUID();
  const job: Job = {
    id,
    status: 'running',
    history: [],
    subscribers: new Set(),
    child: null,
    cancelled: false,
  };
  jobs.set(id, job);

  void runPasses(job, options);
  return id;
}

/**
 * ffmpeg emits a progress block far more often than a person can read one, and
 * every one of them crosses the SSE stream and re-renders the client. Ten a
 * second is already smoother than the eye resolves; the rest is just work.
 * The final frame of each pass is never dropped — see below.
 */
const PROGRESS_INTERVAL_MS = 100;

async function runPasses(job: Job, options: StartJobOptions): Promise<void> {
  const startedAt = Date.now();
  const passes = options.plan.passes;
  let lastEmit = 0;

  /**
   * What an earlier pass measured, for the passes that need it.
   *
   * Only loudnorm uses this, and it is the reason the plan is a list of passes
   * rather than one command: pass two cannot be written until pass one has run.
   */
  let measurement: LoudnormMeasurement | null = null;

  try {
    for (const [index, pass] of passes.entries()) {
      // The placeholders are substituted here and nowhere else, so what spawns
      // is the pass's own argv with exactly the marked values filled in.
      const argv = measurement === null ? pass.argv : applyMeasurement(pass.argv, measurement);

      const result = await runPass(
        job,
        options.ffmpeg,
        argv,
        (fraction) => {
          const now = Date.now();
          // Always let a completed pass through, so the bar never stalls at 97%
          // because the last update happened to arrive inside the window.
          if (fraction < 1 && now - lastEmit < PROGRESS_INTERVAL_MS) return;
          lastEmit = now;
          emit(job, {
            type: 'progress',
            // Passes are treated as equal slices. GIF's palettegen is much shorter
            // than its paletteuse, so the bar is honest about order but not about
            // wall-clock weighting — better than a bar that restarts at zero.
            progress: (index + fraction) / passes.length,
            passIndex: index,
            passCount: passes.length,
            passLabel: pass.label,
            elapsedMs: Date.now() - startedAt,
          });
        },
        pass.outputDurationSec,
      );

      if (job.cancelled) {
        job.status = 'cancelled';
        emit(job, { type: 'cancelled' });
        await fs.rm(options.outputPath, { force: true }).catch(() => undefined);
        return;
      }

      if (pass.capture === 'loudnorm-json') {
        measurement = parseLoudnorm(result.stderr);
        if (measurement === null && result.code === 0) {
          job.status = 'failed';
          emit(job, {
            type: 'error',
            message: 'Could not read the loudness measurement from ffmpeg.',
            detail: lastLines(result.stderr, 15),
          });
          return;
        }
      }

      if (result.code !== 0) {
        job.status = 'failed';
        emit(job, {
          type: 'error',
          message: `ffmpeg exited with code ${String(exitCode(result.code))}.`,
          detail: lastLines(result.stderr, 15),
        });
        await fs.rm(options.outputPath, { force: true }).catch(() => undefined);
        return;
      }
    }

    const stats = await fs.stat(options.outputPath);
    const outputId = randomUUID();
    putFile({
      id: outputId,
      path: options.outputPath,
      displayName: options.outputName,
      meta: null,
      kind: 'output',
      createdAt: Date.now(),
    });

    job.status = 'done';
    emit(job, {
      type: 'done',
      outputId,
      outputName: options.outputName,
      sizeBytes: stats.size,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    job.status = 'failed';
    emit(job, {
      type: 'error',
      message: error instanceof Error ? error.message : 'The operation failed.',
      detail: [],
    });
  } finally {
    job.subscribers.clear();
    // Keep the record around briefly so a reconnecting client can still read the
    // outcome, then let it go — this map is the only thing holding it.
    setTimeout(() => jobs.delete(job.id), 60_000).unref();
  }
}

type PassResult = { readonly code: number | null; readonly stderr: string };

/**
 * ffmpeg's exit code, as a number a person can look up.
 *
 * Windows hands back negative codes as unsigned 32-bit values, so ffmpeg's -22
 * arrived as 4294967274. Nobody can search for that, and it reads as a crash
 * rather than as the EINVAL it is.
 */
function exitCode(code: number | null): number | string {
  if (code === null) return 'unknown';
  return code > 0x7fffffff ? code - 0x100000000 : code;
}

function runPass(
  job: Job,
  ffmpeg: FfmpegTool,
  argv: readonly string[],
  onProgress: (fraction: number) => void,
  outputDurationSec: number | null,
): Promise<PassResult> {
  return new Promise((resolve, reject) => {
    // The argv is exactly what buildArgs produced and exactly what the command
    // bar showed. Nothing is added here.
    const child = spawn(ffmpeg.path, [...argv], { shell: false, windowsHide: true });
    job.child = child;

    let stderr = '';
    let stdoutBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      // -progress emits whole lines; the last fragment may be partial.
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const microseconds = parseOutTime(line);
        if (microseconds === null || outputDurationSec === null || outputDurationSec <= 0) continue;
        const fraction = microseconds / 1_000_000 / outputDurationSec;
        onProgress(Math.min(1, Math.max(0, fraction)));
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // ffmpeg can be chatty on a bad input; only the tail is ever shown.
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      job.child = null;
      resolve({ code, stderr });
    });
  });
}

/**
 * `out_time_us=12400000` -> 12400000.
 *
 * Deliberately not `out_time_ms`, which ffmpeg has long reported in microseconds
 * despite its name — reading it as milliseconds makes every encode look 1000x
 * further along than it is.
 */
function parseOutTime(line: string): number | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('out_time_us=')) return null;
  const value = Number.parseInt(trimmed.slice('out_time_us='.length), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function lastLines(text: string, count: number): readonly string[] {
  return text
    .trimEnd()
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-count);
}
