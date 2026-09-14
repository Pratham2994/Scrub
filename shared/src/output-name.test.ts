import { describe, expect, it } from 'vitest';

import type { Operation } from './operations.js';
import { operationSuffix, outputExtension, outputNameFor, outputPathFor } from './output-name.js';

/**
 * One source for the whole table, so the extension column shows which
 * operations change the container and which keep the source's. The audio
 * operations keep it, which is why audio-trim comes out .mp4 here — on a real
 * audio file it would be that file's container, and availability never offers
 * audio-trim on a video in the first place.
 */
const SOURCE = '/work/.tmp/holiday-clip-3036c17e.mp4';
const DISPLAY = 'holiday clip.mp4';

/**
 * Every operation, with settings that are not the defaults where there are
 * defaults to differ from. The names these produce are part of the command the
 * bar shows, so they are pinned the same way the argv is.
 */
const ALL: readonly Operation[] = [
  { kind: 'trim', startSec: 2, endSec: 8.25, mode: 'fast' },
  { kind: 'trim', startSec: 62, endSec: 124.5, mode: 'precise' },
  { kind: 'compress', crf: 28, preset: 'medium' },
  { kind: 'compress', crf: 23, preset: 'veryslow' },
  { kind: 'convert', container: 'webm' },
  { kind: 'resize', width: 1280 },
  { kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null },
  { kind: 'gif', fps: 24, width: 640, startSec: 1.5, endSec: 4 },
  { kind: 'extract-audio', format: 'mp3' },
  { kind: 'extract-audio', format: 'aac' },
  { kind: 'mute' },
  { kind: 'replace-audio', audioId: 'abc' },
  { kind: 'audio-convert', format: 'opus', bitrateKbps: null },
  { kind: 'audio-convert', format: 'mp3', bitrateKbps: 192 },
  { kind: 'audio-trim', startSec: 0, endSec: 30 },
  { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
];

describe('what the output file is called', () => {
  it('names every operation the same way it did last time', () => {
    expect(ALL.map((op) => outputNameFor(DISPLAY, op, SOURCE))).toMatchInlineSnapshot(`
      [
        "holiday clip-trim-2s-8.3s.mp4",
        "holiday clip-trim-1m02s-2m04.5s-precise.mp4",
        "holiday clip-compress-crf28.mp4",
        "holiday clip-compress-crf23-veryslow.mp4",
        "holiday clip-convert.webm",
        "holiday clip-resize-1280w.mp4",
        "holiday clip-gif-12fps-480w.gif",
        "holiday clip-gif-24fps-640w-1.5s-4s.gif",
        "holiday clip-audio.mp3",
        "holiday clip-audio.m4a",
        "holiday clip-muted.mp4",
        "holiday clip-new-audio.mp4",
        "holiday clip-convert.opus",
        "holiday clip-convert-192k.mp3",
        "holiday clip-trim-0s-30s.mp4",
        "holiday clip-loudness-16lufs.mp4",
      ]
    `);
  });

  /**
   * The bug this module was written for. ffmpeg chooses its muxer from the
   * extension, so a preview that said `.mp4` for a WebM convert was telling the
   * user that copying the command would give them VP9 and Opus inside an MP4 —
   * a different file from the one Scrub had just written.
   */
  it('gives the container the operation actually produces', () => {
    expect(outputExtension({ kind: 'convert', container: 'webm' }, SOURCE)).toBe('.webm');
    expect(
      outputExtension({ kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null }, SOURCE),
    ).toBe('.gif');
    // AAC goes in an m4a. A bare .aac is a raw ADTS stream many players refuse.
    expect(outputExtension({ kind: 'extract-audio', format: 'aac' }, SOURCE)).toBe('.m4a');
    // Operations that do not change the container keep the source's.
    expect(outputExtension({ kind: 'mute' }, '/t/a.mkv')).toBe('.mkv');
  });

  it('tells two runs of one operation apart by their settings', () => {
    const first = outputNameFor(
      DISPLAY,
      { kind: 'trim', startSec: 0, endSec: 5, mode: 'fast' },
      SOURCE,
    );
    const second = outputNameFor(
      DISPLAY,
      { kind: 'trim', startSec: 5, endSec: 9, mode: 'fast' },
      SOURCE,
    );
    // Both used to be `holiday clip-trim.mp4`, which is no help in a downloads
    // folder and makes the second save `holiday clip-trim (1).mp4`.
    expect(first).not.toBe(second);
  });

  it('separates a precise trim from a fast one over the same range', () => {
    const range = { startSec: 1, endSec: 2 } as const;
    expect(operationSuffix({ kind: 'trim', ...range, mode: 'fast' })).not.toBe(
      operationSuffix({ kind: 'trim', ...range, mode: 'precise' }),
    );
  });

  it('keeps the same settings on the same name, so a re-run overwrites itself', () => {
    const op: Operation = { kind: 'compress', crf: 23, preset: 'medium' };
    expect(outputPathFor(SOURCE, op)).toBe(outputPathFor(SOURCE, op));
  });

  it('writes next to the source, keeping the working copy out of the saved name', () => {
    const op: Operation = { kind: 'mute' };
    expect(outputPathFor(SOURCE, op)).toBe('/work/.tmp/holiday-clip-3036c17e-muted.mp4');
    // The random suffix Scrub adds on upload never reaches the user's disk.
    expect(outputNameFor(DISPLAY, op, SOURCE)).toBe('holiday clip-muted.mp4');
  });

  it('handles Windows paths, which is where it actually runs', () => {
    expect(outputPathFor('D:\\Code\\Scrub\\.tmp\\clip-7d2c.mp4', { kind: 'mute' })).toBe(
      'D:\\Code\\Scrub\\.tmp\\clip-7d2c-muted.mp4',
    );
  });

  it('never produces a name that could collide with its own input', () => {
    for (const op of ALL) {
      expect(outputPathFor(SOURCE, op)).not.toBe(SOURCE);
    }
  });

  it('produces names a filesystem will accept', () => {
    for (const op of ALL) {
      const name = outputNameFor(DISPLAY, op, SOURCE);
      expect(name, op.kind).not.toMatch(/[<>:"/\\|?*]/);
      expect(name.length, op.kind).toBeLessThan(120);
    }
  });
});
