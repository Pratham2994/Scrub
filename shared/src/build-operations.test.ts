import { describe, expect, it } from 'vitest';

import { buildArgs, type CommandIo, TRANSPORT_ARGS } from './build-args.js';
import { atempoChain, LOUDNORM_MEASURED, measuredPlaceholder } from './build-operations.js';
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

/**
 * Audio operations are only offered on audio files, because on a video they
 * duplicate Trim and Extract audio. The tests use the file each operation is
 * actually reachable from.
 */
const audioMeta: ProbeResult = { ...meta, video: null, container: 'wav' };

const AUDIO_ONLY = new Set<Operation['kind']>([
  'audio-convert',
  'audio-trim',
  'merge-audio',
  'audio-fade',
  'audio-loop',
  'audio-volume',
]);

const metaFor = (kind: Operation['kind']): ProbeResult => (AUDIO_ONLY.has(kind) ? audioMeta : meta);

const AUDIO_ID = '11111111-2222-4333-8444-555555555555';

/** Extra inputs for the multi-input kinds, per kind's own rules. */
const extraVideo = { path: '/work/.tmp/b-clip.mp4', meta: { ...meta, displayName: 'b.mp4' } };
const extraAudio = { path: '/work/.tmp/b-song.m4a', meta: { ...audioMeta, displayName: 'b.m4a' } };

const ioFor = (kind: Operation['kind']): CommandIo =>
  kind === 'merge' || kind === 'watermark'
    ? { ...withSecond, secondaryInputs: [extraVideo] }
    : kind === 'merge-audio' || kind === 'add-music'
      ? { ...withSecond, secondaryInputs: [extraAudio] }
      : withSecond;

/** One representative of each kind, so no operation can be added without argv. */
const ALL: readonly Operation[] = [
  { kind: 'trim', startSec: 12.4, endSec: 48.1, mode: 'fast' },
  { kind: 'compress', crf: 23, preset: 'medium' },
  { kind: 'convert', container: 'webm' },
  { kind: 'resize', width: 1280 },
  { kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null },
  { kind: 'extract-audio', format: 'mp3' },
  { kind: 'mute' },
  // 48 MiB rather than 9.5: the fixture is ten minutes long, and 9.5 genuinely
  // will not hold that. The refusal has its own test below.
  { kind: 'target-size', targetMiB: 48, audioKbps: 128, maxWidth: 1280 },
  { kind: 'speed', factor: 2 },
  { kind: 'crop', width: 1280, height: 720, x: 320, y: 180 },
  { kind: 'replace-audio', audioId: AUDIO_ID },
  { kind: 'audio-convert', format: 'mp3', bitrateKbps: 192 },
  { kind: 'audio-trim', startSec: 1, endSec: 4 },
  { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
  {
    kind: 'merge',
    clipIds: ['22222222-3333-4444-8555-666666666666'],
    crossfadeSec: 0.5,
    fadeInSec: 0,
    fadeOutSec: 0,
    crf: 20,
  },
  {
    kind: 'merge-audio',
    clipIds: ['22222222-3333-4444-8555-666666666666'],
    crossfadeSec: 2,
    fadeInSec: 0,
    fadeOutSec: 0,
    bitrateKbps: 192,
  },
  {
    kind: 'add-music',
    musicId: '33333333-4444-4555-8666-777777777777',
    originalPercent: 100,
    musicPercent: 35,
  },
  {
    kind: 'watermark',
    imageId: '44444444-5555-4666-8777-888888888888',
    position: 'se',
    opacity: 80,
  },
  { kind: 'fade', fadeInSec: 1, fadeOutSec: 2 },
  { kind: 'audio-fade', fadeInSec: 1, fadeOutSec: 2 },
  { kind: 'loop', times: 3 },
  { kind: 'audio-loop', times: 3 },
  { kind: 'volume', gainDb: 6 },
  { kind: 'audio-volume', gainDb: 6 },
];

describe('buildArgs - every operation', () => {
  it('covers the whole rail, so a new operation cannot ship without argv', () => {
    expect(new Set(ALL.map((op) => op.kind))).toEqual(new Set(OPERATIONS.map((op) => op.kind)));
  });

  it.each(ALL)('$kind produces runnable passes', (op) => {
    const plan = buildArgs(op, metaFor(op.kind), ioFor(op.kind));
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
    for (const pass of buildArgs(op, metaFor(op.kind), ioFor(op.kind)).passes) {
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
    const wav = buildArgs({ kind: 'audio-convert', format: 'wav', bitrateKbps: 192 }, audioMeta, io)
      .passes[0]!;
    expect(wav.argv).not.toContain('-b:a');

    const mp3 = buildArgs({ kind: 'audio-convert', format: 'mp3', bitrateKbps: 192 }, audioMeta, io)
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

describe('loudness pass two declares what pass one must give it', () => {
  const plan = buildArgs(
    { kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 },
    meta,
    io,
  );

  it('marks all five measurements in the second pass', () => {
    const filter = plan.passes[1]!.argv.join(' ');
    for (const key of LOUDNORM_MEASURED) {
      expect(filter).toContain(`${key}=${measuredPlaceholder(key)}`);
    }
  });

  it('does not put placeholders in the measuring pass', () => {
    expect(plan.passes[0]!.argv.join(' ')).not.toContain('@');
  });

  /**
   * The placeholder has to be invalid ffmpeg. If an unsubstituted pass ever
   * reached spawn, it must fail loudly rather than normalise against nothing -
   * which is exactly the silent, pumping result two passes exist to avoid.
   */
  it('uses a marker ffmpeg cannot mistake for a value', () => {
    expect(measuredPlaceholder('measured_I')).toBe('@measured_I@');
    expect(Number.isFinite(Number.parseFloat(measuredPlaceholder('measured_I')))).toBe(false);
  });
});

describe('fitting a size', () => {
  /**
   * The fixture is ten minutes of 1080p. 48 MiB is a target it can actually
   * make; 9.5 is not, and that case is its own test below rather than an
   * accident in these.
   */
  const fit: Operation = {
    kind: 'target-size',
    targetMiB: 48,
    audioKbps: 128,
    maxWidth: 1280,
  };

  it('is two passes, analyse then encode', () => {
    const plan = buildArgs(fit, meta, io);
    expect(plan.passes.map((pass) => pass.label)).toEqual(['Analyse', 'Encode']);
  });

  /**
   * One pass at a fixed bitrate spends it evenly and wastes most of it on the
   * still parts. Two passes let the encoder look at the whole file first and
   * then put the bits where the picture moves, which is the difference between
   * a 10 MB file that is watchable and one that is not.
   */
  it('writes a log in the first pass and reads it in the second', () => {
    const [first, second] = buildArgs(fit, meta, io).passes;
    expect(first?.argv).toContain('-passlogfile');
    expect(second?.argv).toContain('-passlogfile');
    expect(first?.argv.join(' ')).toContain('-pass 1');
    expect(second?.argv.join(' ')).toContain('-pass 2');
    // Both must be told the same video settings, or the measurement describes
    // an encode that never happens.
    expect(first?.argv.join(' ')).toContain('-b:v');
    expect(second?.argv.join(' ')).toContain('-b:v');
  });

  it('writes nothing in the first pass', () => {
    const [first] = buildArgs(fit, meta, io).passes;
    expect(first?.argv).toContain('-an');
    expect(first?.argv.join(' ')).toContain('-f null');
  });

  it('caps the peak, so a busy few seconds cannot blow the budget', () => {
    const argv = buildArgs(fit, meta, io).passes[1]?.argv.join(' ') ?? '';
    expect(argv).toContain('-maxrate');
    expect(argv).toContain('-bufsize');
  });

  it('refuses a length that will not fit, and says what would have', () => {
    // Ten minutes of video into half a mebibyte is not a picture.
    expect(() => buildArgs({ ...fit, targetMiB: 0.5 }, meta, io)).toThrow(InvalidOperation);
    try {
      buildArgs({ ...fit, targetMiB: 0.5 }, meta, io);
    } catch (error) {
      // The refusal has to be actionable, not just a no.
      expect((error as Error).message).toMatch(/longest|most that fits/i);
    }
  });

  it('drops the audio budget entirely when there is no audio', () => {
    const silent: ProbeResult = { ...meta, audio: null };
    const argv = buildArgs(fit, silent, io).passes[1]?.argv.join(' ') ?? '';
    expect(argv).toContain('-an');
    expect(argv).not.toContain('-c:a aac');
  });

  it('will not build for a file with no picture', () => {
    const audioOnly: ProbeResult = { ...meta, video: null };
    expect(() => buildArgs(fit, audioOnly, io)).toThrow(InvalidOperation);
  });

  it('produces the same argv it did last time', () => {
    expect(buildArgs(fit, meta, io).passes.map((pass) => pass.argv)).toMatchInlineSnapshot(`
      [
        [
          "-hide_banner",
          "-nostdin",
          "-nostats",
          "-progress",
          "pipe:1",
          "-i",
          "/work/.tmp/holiday-8f3a4c19.mp4",
          "-c:v",
          "libx264",
          "-b:v",
          "501k",
          "-maxrate",
          "752k",
          "-bufsize",
          "1002k",
          "-vf",
          "scale=min(1280\\,iw):-2",
          "-passlogfile",
          "/work/.tmp/scrub-2pass",
          "-pass",
          "1",
          "-an",
          "-f",
          "null",
          "-",
        ],
        [
          "-hide_banner",
          "-nostdin",
          "-nostats",
          "-progress",
          "pipe:1",
          "-i",
          "/work/.tmp/holiday-8f3a4c19.mp4",
          "-c:v",
          "libx264",
          "-b:v",
          "501k",
          "-maxrate",
          "752k",
          "-bufsize",
          "1002k",
          "-vf",
          "scale=min(1280\\,iw):-2",
          "-passlogfile",
          "/work/.tmp/scrub-2pass",
          "-pass",
          "2",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "-y",
          "/work/.tmp/holiday-out.mp4",
        ],
      ]
    `);
  });
});

describe('speed', () => {
  it('moves the picture and the sound by the same factor', () => {
    const argv = buildArgs({ kind: 'speed', factor: 2 }, meta, io).passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('setpts=PTS/2');
    expect(argv).toContain('atempo=2');
  });

  /**
   * `atempo` clamps to 0.5..2.0 per instance, so anything beyond is a chain.
   * The product of the chain has to be exactly the factor asked for: if it is
   * not, the sound drifts away from the picture as the file plays, which is the
   * one failure this operation must not have.
   */
  it('chains atempo past its limits, and the chain multiplies back', () => {
    for (const factor of [0.25, 0.5, 1, 1.5, 2, 3, 4]) {
      const chain = atempoChain(factor);
      const product = chain
        .split(',')
        .map((step) => Number(step.replace('atempo=', '')))
        .reduce((total, step) => total * step, 1);
      expect(product, `${String(factor)} -> ${chain}`).toBeCloseTo(factor, 3);
    }
  });

  it('keeps every step inside the range atempo accepts', () => {
    for (const factor of [0.25, 0.3, 3, 4]) {
      for (const step of atempoChain(factor).split(',')) {
        const value = Number(step.replace('atempo=', ''));
        expect(value, `${String(factor)} -> ${step}`).toBeGreaterThanOrEqual(0.5);
        expect(value, `${String(factor)} -> ${step}`).toBeLessThanOrEqual(2);
      }
    }
  });

  /**
   * Progress divides against the pass's own output. A 2x speed-up halves the
   * duration, so using the source length here would stop the bar at 50%.
   */
  it('reports the duration of the result, not of the source', () => {
    const faster = buildArgs({ kind: 'speed', factor: 2 }, meta, io).passes[0];
    const slower = buildArgs({ kind: 'speed', factor: 0.5 }, meta, io).passes[0];
    expect(faster?.outputDurationSec).toBeCloseTo(meta.durationSec / 2, 3);
    expect(slower?.outputDurationSec).toBeCloseTo(meta.durationSec * 2, 3);
  });

  it('drops the audio filter when there is no audio to stretch', () => {
    const silent: ProbeResult = { ...meta, audio: null };
    const argv =
      buildArgs({ kind: 'speed', factor: 2 }, silent, io).passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('-an');
    expect(argv).not.toContain('atempo');
  });

  it('refuses a factor outside what atempo can reach', () => {
    expect(() => buildArgs({ kind: 'speed', factor: 0 }, meta, io)).toThrow(InvalidOperation);
    expect(() => buildArgs({ kind: 'speed', factor: 10 }, meta, io)).toThrow(InvalidOperation);
  });

  it('produces the same argv it did last time', () => {
    expect(buildArgs({ kind: 'speed', factor: 2 }, meta, io).passes[0]?.argv)
      .toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        "/work/.tmp/holiday-8f3a4c19.mp4",
        "-vf",
        "setpts=PTS/2",
        "-af",
        "atempo=2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "medium",
        "-movflags",
        "+faststart",
        "-y",
        "/work/.tmp/holiday-out.mp4",
      ]
    `);
  });
});

describe('crop', () => {
  /**
   * libx264 needs even dimensions, and an odd *offset* puts the chroma plane
   * half a pixel out - a colour fringe along the edges rather than an error
   * anyone would notice until they looked closely.
   */
  it('rounds every number down to an even one', () => {
    const argv =
      buildArgs(
        { kind: 'crop', width: 641, height: 361, x: 101, y: 51 },
        meta,
        io,
      ).passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('crop=640:360:100:50');
  });

  it('clamps a rectangle that runs off the edge', () => {
    // ffmpeg fails outright on a crop outside the frame, which is a worse way
    // to learn you dragged too far than simply not being able to.
    const argv =
      buildArgs(
        { kind: 'crop', width: 9999, height: 9999, x: 1900, y: 1000 },
        meta,
        io,
      ).passes[0]?.argv.join(' ') ?? '';
    const [, w, h, x, y] = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(argv) ?? [];
    expect(Number(x) + Number(w)).toBeLessThanOrEqual(meta.video?.width ?? 0);
    expect(Number(y) + Number(h)).toBeLessThanOrEqual(meta.video?.height ?? 0);
  });

  it('copies the sound rather than re-encoding it for nothing', () => {
    const argv =
      buildArgs(
        { kind: 'crop', width: 640, height: 360, x: 0, y: 0 },
        meta,
        io,
      ).passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('-c:a copy');
  });

  it('refuses a selection too small to encode', () => {
    expect(() => buildArgs({ kind: 'crop', width: 8, height: 8, x: 0, y: 0 }, meta, io)).toThrow(
      InvalidOperation,
    );
  });

  it('will not build for a file with no picture', () => {
    const audioOnly: ProbeResult = { ...meta, video: null };
    expect(() =>
      buildArgs({ kind: 'crop', width: 640, height: 360, x: 0, y: 0 }, audioOnly, io),
    ).toThrow(InvalidOperation);
  });

  it('produces the same argv it did last time', () => {
    expect(
      buildArgs({ kind: 'crop', width: 1280, height: 720, x: 320, y: 180 }, meta, io).passes[0]
        ?.argv,
    ).toMatchInlineSnapshot(`
      [
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-progress",
        "pipe:1",
        "-i",
        "/work/.tmp/holiday-8f3a4c19.mp4",
        "-vf",
        "crop=1280:720:320:180",
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "medium",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        "/work/.tmp/holiday-out.mp4",
      ]
    `);
  });
});
