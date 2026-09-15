import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { fingerprintFile } from './fingerprint.js';

/**
 * What stops the same clip being copied into the working directory twice.
 *
 * Not a full hash: a 4 GB video would have to be read end to end to produce
 * one, doubling the I/O of every upload to answer a question that is usually
 * "no". The cost of a false match would be operating on the wrong file, so
 * these tests care much more about the differences it must notice than about
 * the matches it should find.
 */

const DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'scrub-fp-'));
let counter = 0;

async function file(contents: Buffer | string): Promise<string> {
  counter += 1;
  const full = path.join(DIR, `f${String(counter)}.bin`);
  await fs.writeFile(full, contents);
  return full;
}

afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});

describe('the same file', () => {
  it('fingerprints the same twice running', async () => {
    const a = await file('the same bytes');
    expect(await fingerprintFile(a)).toBe(await fingerprintFile(a));
  });

  it('matches an identical copy under a different name', async () => {
    const a = await file('identical contents');
    const b = await file('identical contents');
    expect(await fingerprintFile(a)).toBe(await fingerprintFile(b));
  });
});

describe('a different file', () => {
  it('differs when the length differs, even by one byte', async () => {
    const a = await file('abcdefgh');
    const b = await file('abcdefghi');
    expect(await fingerprintFile(a)).not.toBe(await fingerprintFile(b));
  });

  it('differs when the head differs', async () => {
    const a = await file('AAAAtail');
    const b = await file('BBBBtail');
    expect(await fingerprintFile(a)).not.toBe(await fingerprintFile(b));
  });

  /**
   * The reason the tail is read at all. Containers carry their index at the
   * back, so two exports of the same source can share a long head and differ
   * only at the end.
   */
  it('differs when only the tail differs', async () => {
    const head = Buffer.alloc(2 * 1024 * 1024, 7);
    const a = await file(Buffer.concat([head, Buffer.from('ENDA')]));
    const b = await file(Buffer.concat([head, Buffer.from('ENDB')]));
    expect(await fingerprintFile(a)).not.toBe(await fingerprintFile(b));
  });

  /**
   * The gap this deliberately does not cover: a file larger than 2 MB whose
   * first and last megabyte are identical and whose middle is not. Worth
   * knowing about rather than discovering.
   */
  it('cannot tell two files apart by their middle alone', async () => {
    const head = Buffer.alloc(1024 * 1024, 1);
    const tail = Buffer.alloc(1024 * 1024, 2);
    const a = await file(Buffer.concat([head, Buffer.alloc(1024, 0xaa), tail]));
    const b = await file(Buffer.concat([head, Buffer.alloc(1024, 0xbb), tail]));
    expect(await fingerprintFile(a)).toBe(await fingerprintFile(b));
  });
});

describe('edge cases that must not throw', () => {
  it('handles an empty file', async () => {
    const empty = await file('');
    await expect(fingerprintFile(empty)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles a file smaller than one sample window', async () => {
    const tiny = await file('x');
    await expect(fingerprintFile(tiny)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects rather than returning a fingerprint for a missing file', async () => {
    await expect(fingerprintFile(path.join(DIR, 'not-here.bin'))).rejects.toThrow();
  });
});
