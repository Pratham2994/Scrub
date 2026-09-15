import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The sweeper deletes the user's files. That is reason enough to test it
 * directly rather than through a browser: the failure mode is not a broken
 * layout, it is a clip that was on screen a second ago and is now gone.
 *
 * `config` reads the environment once, at import, so the directory and the
 * limits are set before the module under test is loaded.
 */
const DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-sweep-'));
process.env.SCRUB_TMP_DIR = DIR;
process.env.SCRUB_TMP_TTL_MINUTES = '60';
process.env.SCRUB_TMP_MIN_AGE_MINUTES = '10';
process.env.SCRUB_TMP_MAX_GB = '1';

const { clearTmpDir, ensureTmpDir, storageUsage, sweepTmpDir } = await import('./tmp.js');
const { getFile, putFile } = await import('./store.js');

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

/** A file of a given size, last modified a given number of minutes ago. */
async function write(name: string, bytes: number, ageMinutes: number): Promise<string> {
  const full = path.join(DIR, name);
  await fs.writeFile(full, Buffer.alloc(bytes, 1));
  const when = new Date(NOW - ageMinutes * MINUTE);
  await fs.utimes(full, when, when);
  return full;
}

const listing = async (): Promise<string[]> => (await fs.readdir(DIR)).sort();

beforeEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
  await ensureTmpDir();
});

afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});

describe('the clock', () => {
  it('deletes what is past the TTL and keeps what is not', async () => {
    await write('old.mp4', 10, 90);
    await write('fresh.mp4', 10, 5);

    const result = await sweepTmpDir(NOW);

    expect(await listing()).toEqual(['fresh.mp4']);
    expect(result.removed).toBe(1);
  });

  it('treats the TTL as inclusive, so a file exactly at it goes', async () => {
    await write('exactly.mp4', 10, 60);
    await sweepTmpDir(NOW);
    expect(await listing()).toEqual([]);
  });

  it('leaves an empty directory alone rather than failing', async () => {
    await expect(sweepTmpDir(NOW)).resolves.toMatchObject({ removed: 0, bytes: 0 });
  });
});

describe('the ceiling', () => {
  /**
   * The TTL alone was not enough, and that is not a theory: one afternoon of
   * ordinary use put 2.8 GB here, none of it old enough to expire.
   */
  it('evicts oldest first until the directory fits', async () => {
    const big = 400 * 1024 * 1024; // 400 MB each, cap is 1 GB
    await write('a-oldest.mp4', big, 50);
    await write('b-middle.mp4', big, 40);
    await write('c-newest.mp4', big, 30);

    await sweepTmpDir(NOW);

    // 1.2 GB over a 1 GB cap: the oldest goes and the rest now fit.
    expect(await listing()).toEqual(['b-middle.mp4', 'c-newest.mp4']);
  });

  it('never evicts a file younger than the minimum age, whatever the total', async () => {
    const big = 600 * 1024 * 1024;
    // Both well over the cap between them, both too recent to touch.
    await write('recent-one.mp4', big, 2);
    await write('recent-two.mp4', big, 3);

    await sweepTmpDir(NOW);

    // This is the file on screen and the output of the run that just finished.
    expect(await listing()).toEqual(['recent-one.mp4', 'recent-two.mp4']);
  });

  it('stops as soon as it fits rather than clearing the whole directory', async () => {
    const big = 300 * 1024 * 1024;
    for (const [name, age] of [
      ['a.mp4', 55],
      ['b.mp4', 45],
      ['c.mp4', 35],
      ['d.mp4', 25],
    ] as const) {
      await write(name, big, age);
    }

    await sweepTmpDir(NOW);

    // 1.2 GB over a 1 GB cap: dropping the oldest 300 MB is enough.
    expect(await listing()).toEqual(['b.mp4', 'c.mp4', 'd.mp4']);
  });

  it('does nothing when the directory is already under the cap', async () => {
    await write('small.mp4', 1024, 30);
    const result = await sweepTmpDir(NOW);
    expect(result.removed).toBe(0);
    expect(await listing()).toEqual(['small.mp4']);
  });
});

describe('derived files', () => {
  /**
   * A filmstrip describes one upload. Sweeping the upload and leaving the
   * filmstrip behind means the store still points at an id whose source is
   * gone, so the id is forgotten with the file.
   */
  it('forgets the store entry for a swept filmstrip', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const full = await write(`filmstrip-${id}.jpg`, 10, 90);
    putFile({
      id,
      path: full,
      displayName: 'clip.mp4',
      meta: null,
      kind: 'output',
      createdAt: NOW,
    });
    expect(getFile(id)).not.toBeNull();

    await sweepTmpDir(NOW);

    expect(getFile(id)).toBeNull();
  });

  it('keeps a file whose name merely looks like one', async () => {
    await write('filmstrip-not-a-uuid.jpg', 10, 5);
    await sweepTmpDir(NOW);
    expect(await listing()).toEqual(['filmstrip-not-a-uuid.jpg']);
  });
});

describe('clearing on request', () => {
  it('empties the directory', async () => {
    await write('one.mp4', 10, 1);
    await write('two.mp4', 10, 1);
    await clearTmpDir(null);
    expect(await listing()).toEqual([]);
  });

  /**
   * "Keep this one" exists because the obvious moment to clear space is while
   * looking at a file you are working on, and losing it would be a strange
   * reward for tidying up.
   */
  it('keeps the named file and the artifacts describing it', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await write(`clip-${id}.mp4`, 10, 1);
    await write(`filmstrip-${id}.jpg`, 10, 1);
    await write(`waveform-${id}.png`, 10, 1);
    await write('someone-elses.mp4', 10, 1);

    await clearTmpDir(id);

    expect(await listing()).toEqual([
      `clip-${id}.mp4`,
      `filmstrip-${id}.jpg`,
      `waveform-${id}.png`,
    ]);
  });
});

describe('what the storage panel reports', () => {
  it('counts the bytes and files actually on disk', async () => {
    await write('a.mp4', 1000, 1);
    await write('b.mp4', 2000, 1);

    const usage = await storageUsage();

    expect(usage.files).toBe(2);
    expect(usage.bytes).toBe(3000);
    expect(usage.capBytes).toBe(1024 * 1024 * 1024);
  });

  it('reports an empty directory as empty rather than failing', async () => {
    await expect(storageUsage()).resolves.toMatchObject({ bytes: 0, files: 0 });
  });
});
