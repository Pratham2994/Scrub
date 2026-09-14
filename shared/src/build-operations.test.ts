import { describe, expect, it } from 'vitest';

import { buildArgs, type CommandIo, TRANSPORT_ARGS } from './build-args.js';
import { InvalidOperation } from './errors.js';
import { OPERATIONS, type Operation } from './operations.js';
import type { ProbeResult } from './probe.js';

const meta: ProbeResult = {
  path: '/work/.tmp/holiday-8f3a4c19.mp4',
  displayName: 'holiday-clip.mp4',
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 612.48,
  sizeBytes: 148_922_112,
  bitrate: 1_945_600,
  video: { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 29.97, pixelFormat: 'yuv420p' },
  audio: { index: 1, codec: 'aac', channels: 2, sampleRate: 48_000 },
};

const io: CommandIo = {
  inputPath: '/work/.tmp/holiday-8f3a4c19.mp4',
  outputPath: '/work/.tmp/holiday-out.mp4',
  workDir: '/work/.tmp',
};

const withSecond: CommandIo = { ...io, secondaryInputPath: '/work/.tmp/replacement.m4a' };

const AUDIO_ID = '11111111-2222-4333-8444-555555555555';

/** One representative of each kind, so no operation can be added without argv. */
const ALL: readonly Operation[] = [
  { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'fast' },
  { kind: 'compress', crf: 23, preset: 'medium' },
  { kind: 'convert', container: 'webm' },
  { kind: 'resize', width: 1280 },
  { kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null },
  { kind: 'extract-audio', format: 'mp3' },
  { kind: 'mute' },
  { kind: 'replace-audio', audioId: AUDIO_ID },
  { kind: 'audio-convert', format: 'mp3', bitrateKbps: 192 },
  { kind: 'audio-trim', startSec: 1, endSec: 4 },
  { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
];

describe('buildArgs — every operation', () => {
  it('covers the whole rail, so a new operation cannot ship without argv', () => {
    expect(new Set(ALL.map((op) => op.kind))).toEqual(new Set(OPERATIONS.map((op) => op.kind)));
  });

  it.each(ALL)('$kind produces runnable passes', (op) => {
    const plan = buildArgs(op, meta, withSecond);
    expect(plan.passes.length).toBeGreaterThan(0);

    for (const pass of plan.passes) {
      // Every pass is a real invocation: transport prefix, an input, an output.
      expect(pass.argv.slice(0, TRANSPORT_ARGS.length)).toEqual([...TRANSPORT_ARGS]);
      expect(pass.argv).toContain('-i');
      expect(pass.argv[pass.argv.length - 1]).toBeTruthy();
      expect(pass.label).not.toBe('');
    }
  });

  // The rule the linter also enforces for hand-edited commands. Worth pinning on
  // the generated side too: a filter with `copy` fails, and it fails obscurely.
  it.each(ALL)('$kind never filters while stream-copying', (op) => {
    for (const pass of buildArgs(op, meta, withSecond).passes) {
      const hasFilter = ['-vf', '-filter:v', '-lavfi'].some((f) => pass.argv.includes(f));
      if (!hasFilter) continue;
      const videoCodec = pass.argv[pass.argv.indexOf('-c:v') + 1];
      const allCodec = pass.argv.includes('-c')
        ? pass.argv[pass.argv.indexOf('-c') + 1]
        : undefined;
      expect(videoCodec).not.toBe('copy');
      expect(allCodec).not.toBe('copy');
    }
  });
});

describe('the trap in each operation', () => {
  it('scales with -2, never -1', () => {
    const { argv } = buildArgs({ kind: 'resize', width: 1280 }, meta, io).passes[0]!;
    expect(argv).toContain('scale=1280:-2');
    expect(argv.join(' ')).not.toContain(':-1');
  });

  it('refuses an odd resize width instead of failing inside the encoder', () => {
    expect(() => buildArgs({ kind: 'resize', width: 1281 }, meta, io)).toThrow(InvalidOperation);
  });

  it('builds a GIF in two passes with an identical filter chain', () => {
    const plan = buildArgs(
      { kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null },
      meta,
      io,
    );
    expect(plan.passes).toHaveLength(2);

    const chain = 'fps=12,scale=480:-2:flags=lanczos';
    expect(plan.passes[0]!.argv).toContain(`${chain},palettegen`);
    expect(plan.passes[1]!.argv).toContain(`${chain}[x];[x][1:v]paletteuse`);
    // Differing chains would build the palette from different pixels than it is
    // applied to, which is the whole failure mode two passes exist to avoid.

    // A palette is one PNG: no timeline to divide progress against.
    expect(plan.passes[0]!.outputDurationSec).toBeNull();
  });

  it('applies a GIF window to both passes, or neither', () => {
    const windowed = buildArgs(
      { kind: 'gif', fps: 12, width: 480, startSec: 2, endSec: 5 },
      meta,
      io,
    );
    for (const pass of windowed.passes) {
      expect(pass.argv).toContain('-ss');
      expect(pass.argv[pass.argv.indexOf('-t') + 1]).toBe('3');
    }
  });

  it('remuxes rather than re-encodes when the container already accepts the codec', () => {
    // meta is h264: mkv takes it untouched, webm cannot hold it at all.
    const mkv = buildArgs({ kind: 'convert', container: 'mkv' }, meta, io).passes[0]!;
    expect(mkv.argv).toContain('copy');
    expect(mkv.label).toBe('Remux');

    const webm = buildArgs({ kind: 'convert', container: 'webm' }, meta, io).passes[0]!;
    expect(webm.argv).toContain('libvpx-vp9');
    expect(webm.argv).toContain('libopus');
    expect(webm.argv).not.toContain('copy');
  });

  it('copies an audio track that is already the requested format', () => {
    const aac = buildArgs({ kind: 'extract-audio', format: 'aac' }, meta, io).passes[0]!;
    expect(aac.argv[aac.argv.indexOf('-c:a') + 1]).toBe('copy');

    const mp3 = buildArgs({ kind: 'extract-audio', format: 'mp3' }, meta, io).passes[0]!;
    expect(mp3.argv).toContain('libmp3lame');
  });

  it('omits a bitrate for lossless formats, where it means nothing', () => {
    const wav = buildArgs({ kind: 'audio-convert', format: 'wav', bitrateKbps: 192 }, meta, io)
      .passes[0]!;
    expect(wav.argv).not.toContain('-b:a');

    const mp3 = buildArgs({ kind: 'audio-convert', format: 'mp3', bitrateKbps: 192 }, meta, io)
      .passes[0]!;
    expect(mp3.argv).toContain('192k');
  });

  it('never re-encodes the video when muting', () => {
    const { argv } = buildArgs({ kind: 'mute' }, meta, io).passes[0]!;
    expect(argv).toContain('-an');
    expect(argv[argv.indexOf('-c:v') + 1]).toBe('copy');
  });

  it('maps both streams explicitly when replacing audio', () => {
    const { argv } = buildArgs({ kind: 'replace-audio', audioId: AUDIO_ID }, meta, withSecond)
      .passes[0]!;
    // Without -map, ffmpeg keeps the original audio and still reports success.
    expect(argv).toContain('0:v:0');
    expect(argv).toContain('1:a:0');
    expect(argv).toContain('-shortest');
    expect(argv).toContain(withSecond.secondaryInputPath);
  });

  it('refuses to replace audio with nothing', () => {
    expect(() => buildArgs({ kind: 'replace-audio', audioId: AUDIO_ID }, meta, io)).toThrow(
      InvalidOperation,
    );
  });

  it('measures loudness before applying it, and marks the capture', () => {
    const plan = buildArgs(
      { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
      meta,
      io,
    );
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes[0]!.capture).toBe('loudnorm-json');
    expect(plan.passes[0]!.argv.join(' ')).toContain('print_format=json');
    // Pass one writes nothing; "-" is ffmpeg's name for that.
    expect(plan.passes[0]!.argv[plan.passes[0]!.argv.length - 1]).toBe('-');
    expect(plan.passes[1]!.argv.join(' ')).toContain('linear=true');
  });

  it('rejects a CRF outside the encoder range', () => {
    expect(() => buildArgs({ kind: 'compress', crf: 99, preset: 'medium' }, meta, io)).toThrow(
      InvalidOperation,
    );
  });

  it('refuses audio operations on a file with no audio track', () => {
    const silent: ProbeResult = { ...meta, audio: null };
    expect(() => buildArgs({ kind: 'extract-audio', format: 'mp3' }, silent, io)).toThrow(
      InvalidOperation,
    );
    expect(() => buildArgs({ kind: 'mute' }, silent, io)).toThrow(InvalidOperation);
    expect(() =>
      buildArgs({ kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 }, silent, io),
    ).toThrow(InvalidOperation);
  });
});

describe('operations that must not touch what they were not asked to', () => {
  it('normalising loudness copies the video rather than re-encoding it', () => {
    const plan = buildArgs(
      { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
      meta,
      io,
    );
    const apply = plan.passes[1]!;
    expect(apply.argv[apply.argv.indexOf('-c:v') + 1]).toBe('copy');
  });

  it('does not add a video codec when there is no video', () => {
    const audioOnly: ProbeResult = { ...meta, video: null };
    const plan = buildArgs(
      { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
      audioOnly,
      io,
    );
    expect(plan.passes[1]!.argv).not.toContain('-c:v');
  });

  it('resizing copies the audio rather than re-encoding it', () => {
    const { argv } = buildArgs({ kind: 'resize', width: 640 }, meta, io).passes[0]!;
    expect(argv[argv.indexOf('-c:a') + 1]).toBe('copy');
  });
});
