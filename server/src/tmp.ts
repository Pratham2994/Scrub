import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';

export async function ensureTmpDir(): Promise<string> {
  await fs.mkdir(config.tmpDir, { recursive: true });
  return config.tmpDir;
}

/**
 * Delete anything in the working directory older than the TTL.
 *
 * Video is big and Scrub touches every file twice — once as an upload, once as an
 * export. Without this the directory grows by the size of the user's media library
 * and nobody notices until a disk fills.
 */
export async function sweepTmpDir(now = Date.now()): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(config.tmpDir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const full = path.join(config.tmpDir, entry);
    try {
      const stats = await fs.stat(full);
      if (now - stats.mtimeMs < config.tmpTtlMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      // A file that vanished mid-sweep, or one held open by a running encode.
      // Either way the next sweep gets it; failing the whole pass helps nobody.
    }
  }
  return removed;
}

/** Sweep on boot and on an interval. Returns a stop function for tests. */
export function startTmpSweeper(): () => void {
  void sweepTmpDir();
  const timer = setInterval(() => void sweepTmpDir(), config.tmpSweepIntervalMs);
  // Do not hold the process open purely to run a cleanup timer.
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
