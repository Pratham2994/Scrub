import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { findByFingerprint, forgetFile, getFile, putFile, type StoredFile } from './store.js';

/**
 * Ids map to absolute paths here and nowhere else. Routes look a file up by id
 * and use the stored path — they never join an id onto a directory, which is
 * what makes an id like `../../etc/passwd` fail as "unknown id" rather than
 * resolving to a file.
 */

const DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-store-'));

afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});

let counter = 0;
async function stored(over: Partial<StoredFile> = {}): Promise<StoredFile> {
  counter += 1;
  const file = path.join(DIR, `clip-${String(counter)}.mp4`);
  await fs.writeFile(file, 'not really a video');
  const entry: StoredFile = {
    id: `id-${String(counter)}`,
    path: file,
    displayName: 'clip.mp4',
    meta: null,
    kind: 'source',
    createdAt: Date.now(),
    ...over,
  };
  putFile(entry);
  return entry;
}

describe('looking a file up', () => {
  it('returns what was put in', async () => {
    const entry = await stored();
    expect(getFile(entry.id)?.path).toBe(entry.path);
  });

  it('returns null for an id it has never seen', () => {
    expect(getFile('nobody')).toBeNull();
  });

  /**
   * The traversal case. An id is never joined onto a directory, so this is not
   * "sanitised" — it simply is not a key anyone registered.
   */
  it('treats a path-shaped id as an unknown id', () => {
    expect(getFile('../../etc/passwd')).toBeNull();
    expect(getFile('..\\..\\windows\\system32\\config\\sam')).toBeNull();
  });

  /**
   * A stale map entry must never become a path that no longer exists: the
   * sweeper deletes files without telling the store, and from a caller's point
   * of view a swept file and an unknown id are the same thing.
   */
  it('forgets an entry whose file has been swept from under it', async () => {
    const entry = await stored();
    await fs.rm(entry.path);
    expect(getFile(entry.id)).toBeNull();
    // And it does not come back if the path is later reused by something else.
    await fs.writeFile(entry.path, 'a different file entirely');
    expect(getFile(entry.id)).toBeNull();
  });

  it('forgets on request', async () => {
    const entry = await stored();
    forgetFile(entry.id);
    expect(getFile(entry.id)).toBeNull();
  });
});

describe('recognising a file that is already here', () => {
  /**
   * Dropping the same clip twice used to copy it twice. One session of ordinary
   * testing left 125 copies of one file on disk, which is the kind of waste
   * nobody notices until the disk is full.
   */
  it('finds an earlier upload by its fingerprint', async () => {
    const entry = await stored({ fingerprint: 'abc123' });
    expect(findByFingerprint('abc123')?.id).toBe(entry.id);
  });

  it('returns null when nothing matches', async () => {
    await stored({ fingerprint: 'something-else' });
    expect(findByFingerprint('no-such-fingerprint')).toBeNull();
  });

  /**
   * Outputs are not candidates for dedupe. Handing back a previous *result* as
   * though the user had just uploaded it would silently swap their input.
   */
  it('never matches an output, only an upload', async () => {
    await stored({ fingerprint: 'shared', kind: 'output' });
    expect(findByFingerprint('shared')).toBeNull();
  });

  it('skips a match whose file is gone and keeps looking', async () => {
    const gone = await stored({ fingerprint: 'duplicate' });
    const present = await stored({ fingerprint: 'duplicate' });
    await fs.rm(gone.path);

    const found = findByFingerprint('duplicate');

    expect(found?.id).toBe(present.id);
    // The dead entry is dropped on the way past rather than left to be found again.
    expect(getFile(gone.id)).toBeNull();
  });
});
