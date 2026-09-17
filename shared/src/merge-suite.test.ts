import { describe, expect, it } from 'vitest';

import { buildArgs } from './build-args.js';
import type { ProbeResult } from './probe.js';

/** 3s 320x180 with audio, the e2e fixture's shape. */
function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    path: '/work/.tmp/a-3036c17e.mp4',
    displayName: 'a.mp4',
    container: 'mp4',
    durationSec: 3,
    sizeBytes: 47_000,
    bitrate: null,
    video: { index: 0, codec: 'h264', width: 320, height: 180, fps: 30, pixelFormat: 'yuv420p' },
    audio: { index: 1, codec: 'aac', channels: 2, sampleRate: 48_000 },
    ...overrides,
  };
}

const B = {
  path: '/work/.tmp/b-7d2c.mp4',
  meta: probe({ path: '/work/.tmp/b-7d2c.mp4', displayName: 'b.mp4', durationSec: 4 }),
};

const C = {
  path: '/work/.tmp/c-1f9a.mp4',
  meta: probe({ path: '/work/.tmp/c-1f9a.mp4', displayName: 'c.mp4', durationSec: 5 }),
};

const io = (secondaries: readonly { path: string; meta: ProbeResult }[]) => ({
  inputPath: '/work/.tmp/a-3036c17e.mp4',
  outputPath: '/work/.tmp/a-3036c17e-merge.mp4',
  workDir: '/work/.tmp',
  secondaryInputs: secondaries,
});

describe('merge', () => {
  it('crossfades two clips with the offset arithmetic pinned', () => {
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b'], crossfadeSec: 0.5, fadeInSec: 0, fadeOutSec: 0, crf: 20 },
      probe(),
      io([B]),
    );
    // The offsets are the accumulated durations minus the overlaps: 3 - 0.5 = 2.5.
    expect(plan.passes[0]?.argv.join(' ')).toContain(
      'xfade=transition=fade:duration=0.5:offset=2.5',
    );
    expect(plan.passes[0]?.argv.join(' ')).toContain('acrossfade=d=0.5');
    // Output runs for 3 + 4 - 0.5 = 6.5 seconds.
    expect(plan.passes[0]?.outputDurationSec).toBe(6.5);
  });

  /**
   * xfade blends in a wider format than it is given, so an ordinary yuv420p
   * source came out High 4:4:4 Predictive: ffmpeg succeeded and Windows Media
   * Player refused the file. Nothing in the picture wanted 4:4:4; the filter
   * simply offered it and libx264 took it.
   */
  it('pins the pixel format so the joined file plays where clips play', () => {
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b'], crossfadeSec: 0.5, fadeInSec: 0, fadeOutSec: 0, crf: 20 },
      probe(),
      io([B]),
    );
    const argv = plan.passes[0]?.argv ?? [];
    expect(argv[argv.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
  });

  it('accumulates the offsets across three clips', () => {
    const plan = buildArgs(
      {
        kind: 'merge',
        clipIds: ['b', 'c'],
        crossfadeSec: 1,
        fadeInSec: 0,
        fadeOutSec: 0,
        crf: 20,
      },
      probe(),
      io([B, C]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    // Second junction: 3 + 4 - 2 = 5.
    expect(argv).toContain('xfade=transition=fade:duration=1:offset=5');
    expect(plan.passes[0]?.outputDurationSec).toBe(10);
  });

  it('normalizes every clip to the first one, even dimensions included', () => {
    const wide = {
      path: '/work/.tmp/b-7d2c.mp4',
      meta: probe({
        path: '/work/.tmp/b-7d2c.mp4',
        displayName: 'b.mp4',
        video: {
          index: 0,
          codec: 'h264',
          width: 641,
          height: 361,
          fps: 25,
          pixelFormat: 'yuv420p',
        },
      }),
    };
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b'], crossfadeSec: 0, fadeInSec: 0, fadeOutSec: 0, crf: 20 },
      probe(),
      io([wide]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('scale=320:180,setsar=1,fps=30');
  });

  it('splices silence in for a clip with no audio', () => {
    const silent = {
      path: B.path,
      meta: probe({ path: B.path, durationSec: 4, audio: null }),
    };
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b'], crossfadeSec: 0.5, fadeInSec: 0, fadeOutSec: 0, crf: 20 },
      probe(),
      io([silent]),
    );
    expect(plan.passes[0]?.argv.join(' ')).toContain('anullsrc=r=48000:d=4');
  });

  it('appends the fades at the joined ends', () => {
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b'], crossfadeSec: 0, fadeInSec: 1, fadeOutSec: 1, crf: 20 },
      probe(),
      io([B]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    // Total is 7 seconds, so the fade out starts at 6.
    expect(argv).toContain('fade=t=in:st=0:d=1');
    expect(argv).toContain('fade=t=out:st=6:d=1');
    expect(argv).toContain('afade=t=out:st=6:d=1');
  });
});

describe('merge audio', () => {
  /** The primary is a song: audio only. */
  const song = () => probe({ video: null });
  const songB = {
    path: '/work/.tmp/b-7d2c.m4a',
    meta: probe({
      path: '/work/.tmp/b-7d2c.m4a',
      displayName: 'b.m4a',
      video: null,
      durationSec: 4,
    }),
  };

  it('crossfades two songs into an m4a at the chosen bitrate', () => {
    const plan = buildArgs(
      {
        kind: 'merge-audio',
        clipIds: ['b'],
        crossfadeSec: 2,
        fadeInSec: 0,
        fadeOutSec: 0,
        bitrateKbps: 256,
      },
      song(),
      io([songB]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('acrossfade=d=2');
    expect(argv).toContain('-b:a');
    expect(argv).toContain('256k');
  });

  it('refuses a clip with a picture', () => {
    expect(() =>
      buildArgs(
        {
          kind: 'merge-audio',
          clipIds: ['b'],
          crossfadeSec: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
          bitrateKbps: 192,
        },
        song(),
        io([{ path: '/work/x.mp4', meta: probe() }]),
      ),
    ).toThrow(/picture/i);
  });
});

describe('add music', () => {
  it('mixes the two tracks at their percentages and copies the picture', () => {
    const plan = buildArgs(
      { kind: 'add-music', musicId: 'm', originalPercent: 100, musicPercent: 35 },
      probe(),
      io([B]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('[0:a]volume=1[a0]');
    expect(argv).toContain('[1:a]volume=0.35[a1]');
    expect(argv).toContain('amix=inputs=2:duration=first');
    expect(argv).toContain('-c:v');
    expect(argv).toContain('copy');
  });

  it('takes the music alone when the video has no audio of its own', () => {
    const plan = buildArgs(
      { kind: 'add-music', musicId: 'm', originalPercent: 100, musicPercent: 50 },
      { ...probe(), audio: null },
      io([B]),
    );
    expect(plan.passes[0]?.argv.join(' ')).not.toContain('[0:a]');
  });
});

describe('watermark', () => {
  it('caps the mark at a quarter of the frame and places it', () => {
    const plan = buildArgs(
      { kind: 'watermark', imageId: 'i', position: 'se', opacity: 80 },
      probe(),
      io([B]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('scale=min(iw\\,80):-2');
    expect(argv).toContain('colorchannelmixer=aa=0.8');
    expect(argv).toContain('overlay=W-w-10:H-h-10');
  });
});

describe('fade, loop, volume', () => {
  it('fades both streams and refuses to do nothing', () => {
    const plan = buildArgs({ kind: 'fade', fadeInSec: 1, fadeOutSec: 2 }, probe(), io([]));
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('fade=t=in:st=0:d=1');
    expect(argv).toContain('afade=t=out:st=1:d=2');
    expect(() => buildArgs({ kind: 'fade', fadeInSec: 0, fadeOutSec: 0 }, probe(), io([]))).toThrow(
      /nothing/i,
    );
  });

  it('loops with the right count: -stream_loop counts extra plays', () => {
    const plan = buildArgs({ kind: 'loop', times: 3 }, probe(), io([]));
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('-stream_loop');
    expect(argv).toContain('2');
    expect(plan.passes[0]?.outputDurationSec).toBe(9);
  });

  it('keeps the picture while the sound gains volume', () => {
    const plan = buildArgs({ kind: 'volume', gainDb: 6 }, probe(), io([]));
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('volume=6dB');
    expect(argv).toContain('-c:v');
    expect(argv).toContain('copy');
  });
});
