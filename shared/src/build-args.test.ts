import { describe, expect, it } from 'vitest';

import { buildArgs, TRANSPORT_ARGS, type CommandIo } from './build-args.js';
import { InvalidOperation } from './errors.js';
import type { Operation } from './operations.js';
import type { ProbeResult } from './probe.js';

const meta: ProbeResult = {
  path: '/work/.tmp/8f3a4c19-c21b.mp4',
  displayName: 'holiday-clip.mp4',
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 612.48,
  sizeBytes: 148_922_112,
  bitrate: 1_945_600,
  video: {
    index: 0,
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 29.97,
    pixelFormat: 'yuv420p',
  },
  audio: { index: 1, codec: 'aac', channels: 2, sampleRate: 48_000 },
};

const io: CommandIo = {
  inputPath: '/work/.tmp/8f3a4c19-c21b.mp4',
  outputPath: '/work/.tmp/2d71b0e4-9a35.mp4',
  workDir: '/work/.tmp',
};

describe('buildArgs — fast trim', () => {
  // This snapshot is the contract. Both the command bar and spawn() consume this
  // array, so a diff here is a change to what Scrub actually executes, never a
  // cosmetic one. Update it deliberately or not at all.
  it('produces the exact argv that will be spawned', () => {
    const op: Operation = { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'fast' };

    expect(buildArgs(op, meta, io)).toMatchInlineSnapshot(`
      {
        "passes": [
          {
            "argv": [
              "-hide_banner",
              "-nostdin",
              "-nostats",
              "-progress",
              "pipe:1",
              "-ss",
              "12.4",
              "-i",
              "/work/.tmp/8f3a4c19-c21b.mp4",
              "-t",
              "35.7",
              "-c",
              "copy",
              "-avoid_negative_ts",
              "make_zero",
              "-y",
              "/work/.tmp/2d71b0e4-9a35.mp4",
            ],
            "label": "Trim",
            "outputDurationSec": 35.7,
          },
        ],
      }
    `);
  });

  it('converts start/end into a duration rather than passing -to', () => {
    const op: Operation = { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'fast' };
    const { argv } = buildArgs(op, meta, io).passes[0]!;

    expect(argv).not.toContain('-to');
    expect(argv[argv.indexOf('-t') + 1]).toBe('35.7');
  });

  it('seeks before -i so the demuxer skips instead of decoding', () => {
    const op: Operation = { kind: 'trim', startSec: 30, endSec: 45, mode: 'fast' };
    const { argv } = buildArgs(op, meta, io).passes[0]!;

    expect(argv.indexOf('-ss')).toBeLessThan(argv.indexOf('-i'));
  });

  it('reports the trimmed duration as the progress denominator, not the source duration', () => {
    const op: Operation = { kind: 'trim', startSec: 60, endSec: 90, mode: 'fast' };
    const [pass] = buildArgs(op, meta, io).passes;

    expect(pass?.outputDurationSec).toBe(30);
    expect(pass?.outputDurationSec).not.toBe(meta.durationSec);
  });

  it('clamps an end past the source duration so the command matches what runs', () => {
    const op: Operation = { kind: 'trim', startSec: 600, endSec: 999, mode: 'fast' };
    const { argv } = buildArgs(op, meta, io).passes[0]!;

    expect(argv[argv.indexOf('-t') + 1]).toBe('12.48');
  });

  it('carries the real paths, so preview and spawn cannot diverge', () => {
    const op: Operation = { kind: 'trim', startSec: 1, endSec: 2, mode: 'fast' };
    const { argv } = buildArgs(op, meta, io).passes[0]!;

    expect(argv).toContain(io.inputPath);
    expect(argv[argv.length - 1]).toBe(io.outputPath);
  });

  it('leads with the transport flags the command bar dims', () => {
    const op: Operation = { kind: 'trim', startSec: 1, endSec: 2, mode: 'fast' };
    const { argv } = buildArgs(op, meta, io).passes[0]!;

    expect(argv.slice(0, TRANSPORT_ARGS.length)).toEqual([...TRANSPORT_ARGS]);
  });

  it('rejects a trim whose end does not follow its start', () => {
    const op: Operation = { kind: 'trim', startSec: 48.1, endSec: 12.4, mode: 'fast' };

    expect(() => buildArgs(op, meta, io)).toThrow(InvalidOperation);
  });
});

describe('buildArgs — precise trim', () => {
  const op: Operation = { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'precise' };

  it('produces the exact argv that will be spawned', () => {
    expect(buildArgs(op, meta, io)).toMatchInlineSnapshot(`
      {
        "passes": [
          {
            "argv": [
              "-hide_banner",
              "-nostdin",
              "-nostats",
              "-progress",
              "pipe:1",
              "-i",
              "/work/.tmp/8f3a4c19-c21b.mp4",
              "-ss",
              "12.4",
              "-t",
              "35.7",
              "-c:v",
              "libx264",
              "-crf",
              "18",
              "-preset",
              "veryfast",
              "-c:a",
              "copy",
              "-y",
              "/work/.tmp/2d71b0e4-9a35.mp4",
            ],
            "label": "Trim",
            "outputDurationSec": 35.7,
          },
        ],
      }
    `);
  });

  it('seeks after -i, which is what makes it frame-accurate', () => {
    const { argv } = buildArgs(op, meta, io).passes[0]!;
    expect(argv.indexOf('-ss')).toBeGreaterThan(argv.indexOf('-i'));
  });

  it('re-encodes video but copies audio', () => {
    const { argv } = buildArgs(op, meta, io).passes[0]!;
    expect(argv[argv.indexOf('-c:v') + 1]).toBe('libx264');
    expect(argv[argv.indexOf('-c:a') + 1]).toBe('copy');
  });

  it('shares the trim window with fast mode', () => {
    const fast = buildArgs({ ...op, mode: 'fast' }, meta, io).passes[0]!;
    const precise = buildArgs(op, meta, io).passes[0]!;
    expect(precise.outputDurationSec).toBe(fast.outputDurationSec);
    expect(precise.argv[precise.argv.indexOf('-t') + 1]).toBe(
      fast.argv[fast.argv.indexOf('-t') + 1],
    );
  });

  it('rejects an inverted range in either mode', () => {
    expect(() => buildArgs({ ...op, startSec: 9, endSec: 2 }, meta, io)).toThrow(InvalidOperation);
  });
});
