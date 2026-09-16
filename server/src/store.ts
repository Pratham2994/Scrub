import fs from 'node:fs';

import type { ProbeResult } from '@scrub/shared';

/**
 * What Scrub knows about a file it is holding.
 *
 * Ids map to absolute paths here and nowhere else. Routes look a file up by id
 * and use the stored path - they never join an id onto a directory, so an id
 * like `../../etc/passwd` fails as "unknown id" instead of resolving to a file.
 */
export type StoredFile = {
  readonly id: string;
  readonly path: string;
  readonly displayName: string;
  /** Sources are probed on upload. Outputs are probed lazily, if at all. */
  readonly meta: ProbeResult | null;
  readonly kind: 'source' | 'output';
  readonly createdAt: number;
  /** Set for uploads, so the same file dropped twice is recognised. */
  readonly fingerprint?: string;
};

/**
 * In memory on purpose. Scrub is a single local process with a tmp directory
 * that gets swept on a TTL - persisting this to disk would mean outliving the
 * files it points at, which is worse than forgetting.
 */
const files = new Map<string, StoredFile>();

export function putFile(file: StoredFile): void {
  files.set(file.id, file);
}

/**
 * Returns null for an unknown id *and* for a known id whose file the TTL sweeper
 * has since deleted - from the caller's point of view those are the same thing,
 * and a stale map entry must never become a path that no longer exists.
 */
export function getFile(id: string): StoredFile | null {
  const found = files.get(id);
  if (!found) return null;
  if (!fs.existsSync(found.path)) {
    files.delete(id);
    return null;
  }
  return found;
}

export function forgetFile(id: string): void {
  files.delete(id);
}

/**
 * An upload of this exact file that Scrub already has.
 *
 * Dropping the same clip twice used to copy it twice. One session of ordinary
 * testing left 125 copies of one file on disk, which is the kind of waste nobody
 * notices until the disk is full.
 */
export function findByFingerprint(fingerprint: string): StoredFile | null {
  for (const file of files.values()) {
    if (file.kind !== 'source' || file.fingerprint !== fingerprint) continue;
    if (!fs.existsSync(file.path)) {
      files.delete(file.id);
      continue;
    }
    return file;
  }
  return null;
}

/**
 * Files already in the working folder, newest first.
 *
 * A 4 GB clip that was open twenty minutes ago is still sitting on disk,
 * probed, with a filmstrip and a waveform already drawn. Making the user upload
 * it again to carry on with it is asking them to wait for something that has
 * not gone anywhere.
 *
 * Sources only. An output is reachable from the result panel that made it, and
 * offering every intermediate file as a starting point would bury the handful
 * of real ones.
 */
export function recentSources(limit: number): readonly StoredFile[] {
  return [...files.values()]
    .filter((file) => file.kind === 'source' && file.meta !== null)
    .filter((file) => {
      // The sweeper deletes without telling the store, so presence is checked
      // rather than assumed - the same rule getFile follows.
      if (fs.existsSync(file.path)) return true;
      files.delete(file.id);
      return false;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
