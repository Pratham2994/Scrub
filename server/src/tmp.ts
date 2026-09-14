import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { forgetFile } from './store.js';

export async function ensureTmpDir(): Promise<string> {
  await fs.mkdir(config.tmpDir, { recursive: true });
  return config.tmpDir;
}

type Entry = {
  readonly name: string;
  readonly full: string;
  readonly size: number;
  readonly modified: number;
};

async function listEntries(): Promise<readonly Entry[]> {
  let names: string[];
  try {
    names = await fs.readdir(config.tmpDir);
  } catch {
    return [];
  }

  const entries: Entry[] = [];
  for (const name of names) {
    const full = path.join(config.tmpDir, name);
    try {
      const stats = await fs.stat(full);
      if (!stats.isFile()) continue;
      entries.push({ name, full, size: stats.size, modified: stats.mtimeMs });
    } catch {
      // Vanished between readdir and stat. The next sweep will not miss it.
    }
  }
  return entries;
}

export type StorageUsage = {
  readonly bytes: number;
  readonly files: number;
  readonly capBytes: number;
};

export async function storageUsage(): Promise<StorageUsage> {
  const entries = await listEntries();
  return {
    bytes: entries.reduce((total, entry) => total + entry.size, 0),
    files: entries.length,
    capBytes: config.tmpMaxBytes,
  };
}

/**
 * The id a working file belongs to, or null for something unrecognised.
 *
 * Uploads are named `<stem>-<8 hex>.<ext>` and derived artifacts are named
 * `filmstrip-<uuid>.jpg` or `waveform-<uuid>.png`, so a filmstrip can be dropped
 * along with the upload it describes rather than lingering alone.
 */
function derivedFrom(name: string): string | null {
  const match = /^(?:filmstrip|waveform)-([0-9a-f-]{36})\./.exec(name);
  return match?.[1] ?? null;
}

/**
 * Delete what is past its time, then keep deleting until the directory fits.
 *
 * The TTL alone was not enough, and that is not a theory: one afternoon of
 * ordinary use put 2.8 GB here, none of it old enough to expire. Video is large,
 * every run writes another file, and a person compressing a few clips before
 * lunch can fill a disk without Scrub ever saying anything.
 *
 * So there is a ceiling as well as a clock, and it evicts oldest first. Nothing
 * under a few minutes old is touched whatever the total, because that is almost
 * certainly the file on screen or the output of a run that has just finished.
 */
export async function sweepTmpDir(now = Date.now()): Promise<{ removed: number; bytes: number }> {
  const entries = await listEntries();
  let removed = 0;
  let freed = 0;

  const drop = async (entry: Entry): Promise<void> => {
    try {
      await fs.rm(entry.full, { force: true });
      removed += 1;
      freed += entry.size;
      const owner = derivedFrom(entry.name);
      if (owner !== null) forgetFile(owner);
    } catch {
      // Held open by a running encode. The next sweep gets it.
    }
  };

  const survivors: Entry[] = [];
  for (const entry of entries) {
    if (now - entry.modified >= config.tmpTtlMs) await drop(entry);
    else survivors.push(entry);
  }

  let total = survivors.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= config.tmpMaxBytes) return { removed, bytes: freed };

  // Oldest first, but never anything recent enough to still be in play.
  const evictable = survivors
    .filter((entry) => now - entry.modified > config.tmpMinAgeMs)
    .sort((a, b) => a.modified - b.modified);

  for (const entry of evictable) {
    if (total <= config.tmpMaxBytes) break;
    await drop(entry);
    total -= entry.size;
  }

  return { removed, bytes: freed };
}

/**
 * Empty the working directory on request, keeping one file if asked.
 *
 * "Keep this one" exists because the obvious moment to clear space is while
 * looking at a file you are working on, and losing it would be a strange reward
 * for tidying up.
 */
export async function clearTmpDir(
  keepId: string | null,
): Promise<{ removed: number; bytes: number }> {
  const entries = await listEntries();
  let removed = 0;
  let freed = 0;

  for (const entry of entries) {
    if (keepId !== null) {
      if (entry.name.includes(keepId)) continue;
      if (derivedFrom(entry.name) === keepId) continue;
    }
    try {
      await fs.rm(entry.full, { force: true });
      removed += 1;
      freed += entry.size;
    } catch {
      // In use. Leave it.
    }
  }
  return { removed, bytes: freed };
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
