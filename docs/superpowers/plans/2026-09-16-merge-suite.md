# Merge Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the merge suite to Scrub: merge (video), merge audio, add music, watermark, fade, audio fade, loop, audio loop, volume, audio volume, and the Save this frame button on the video well.

**Architecture:** Ten new operation kinds flow through the existing pipeline untouched: pure `buildArgs` builders in shared, zod mirrors in the server schema, params in the store, panels in the client, all against the queue/SSE machinery that already runs every operation. Multi-input ops follow replace-audio's exact pattern: the operation carries upload ids, the server resolves them to paths and metas into `io.secondaryInputs`, and the client preview builds the same io from per-op params. The copy discipline from the spec: loop and volume-on-video never re-encode; merge, add-music, watermark, and fades re-encode only what ffmpeg forces.

**Tech Stack:** TypeScript strict everywhere, ffmpeg filter graphs (`xfade`, `acrossfade`, `amix`, `overlay`, `fade`/`afade`, `volume`, `-stream_loop`), Tailwind v4 panels in the existing Field/Panel vocabulary, Playwright e2e against real ffmpeg.

**Spec:** `docs/superpowers/specs/2026-09-16-merge-suite-design.md` (read both; the plan argues from it)

## Global Constraints

- No em dashes anywhere: copy, comments, commit messages.
- The command bar shows exactly what runs: one `buildArgs`, one argv array, no second code path.
- Never shell out; loopback only; both rules untouched by this plan.
- Quality: crf 20 default for forced video re-encodes, aac 192k for forced audio re-encodes, codec map reuse for single-source containers, stream copy wherever ffmpeg allows.
- Amber stays reserved for running states and value tokens.
- Commits: user's git identity only, no AI trailers. Do not push; the user pushes.
- `npm run verify` green at the end (includes the contrast gate from the Tube work).

---

### Task 1: The shared layer: ten kinds, availability, names, builders, tests

**Files:**

- Modify: `shared/src/operations.ts` (types, union, OPERATIONS)
- Modify: `shared/src/availability.ts` (ten cases)
- Modify: `shared/src/output-name.ts` (extensions and suffixes)
- Modify: `shared/src/build-args.ts` (CommandIo, switch cases)
- Modify: `shared/src/build-operations.ts` (seven builders plus helpers)
- Create: `shared/src/merge-suite.test.ts`

**Interfaces:**

- Consumes: `ProbeResult`, `CommandIo`, `CommandPlan`, `TRANSPORT_ARGS`, `OVERWRITE_ARG`, `InvalidOperation`, `CODEC_MAP` (existing, module-local).
- Produces: kinds `merge`, `merge-audio`, `add-music`, `watermark`, `fade`, `audio-fade`, `loop`, `audio-loop`, `volume`, `audio-volume`; `CommandIo.secondaryInputs: readonly { path: string; meta: ProbeResult }[]`; exported `secondaryMetas(io, op)`; `containerFromPath(outputPath)` helper. Tasks 2-7 consume these exact names.

- [ ] **Step 1: Types, union, and rail descriptors**

In `shared/src/operations.ts`, after `AudioLoudness`, add:

```ts
export type WatermarkPosition = 'nw' | 'n' | 'ne' | 'w' | 'center' | 'e' | 'sw' | 's' | 'se';

export type VideoMerge = {
  readonly kind: 'merge';
  /** Upload ids of the clips after the first, in order. The loaded file is clip 0. */
  readonly clipIds: readonly string[];
  /** One global crossfade, 0 is a hard cut. */
  readonly crossfadeSec: number;
  readonly fadeInSec: number;
  readonly fadeOutSec: number;
  readonly crf: number;
};

export type AudioMerge = {
  readonly kind: 'merge-audio';
  readonly clipIds: readonly string[];
  readonly crossfadeSec: number;
  readonly fadeInSec: number;
  readonly fadeOutSec: number;
  readonly bitrateKbps: number;
};

export type VideoAddMusic = {
  readonly kind: 'add-music';
  readonly musicId: string;
  /** Volume as a percentage, so the UI slider never touches dB. */
  readonly originalPercent: number;
  readonly musicPercent: number;
};

export type VideoWatermark = {
  readonly kind: 'watermark';
  readonly imageId: string;
  readonly position: WatermarkPosition;
  readonly opacity: number;
};

export type VideoFade = {
  readonly kind: 'fade';
  readonly fadeInSec: number;
  readonly fadeOutSec: number;
};

export type AudioFade = {
  readonly kind: 'audio-fade';
  readonly fadeInSec: number;
  readonly fadeOutSec: number;
};

export type VideoLoop = {
  readonly kind: 'loop';
  /** How many times the whole file plays, 2 to 16. */
  readonly times: number;
};

export type AudioLoop = {
  readonly kind: 'audio-loop';
  readonly times: number;
};

export type VideoVolume = {
  readonly kind: 'volume';
  readonly gainDb: number;
};

export type AudioVolume = {
  readonly kind: 'audio-volume';
  readonly gainDb: number;
};
```

Extend the union with all ten, and extend OPERATIONS. Video group, after `replace-audio`:

```ts
  { kind: 'merge', label: 'Merge', group: 'video', blurb: 'Join clips, with a crossfade between them.' },
  { kind: 'add-music', label: 'Add music', group: 'video', blurb: 'Put a song under the video, both at your volumes.' },
  { kind: 'watermark', label: 'Watermark', group: 'video', blurb: 'Stamp an image over the picture.' },
  { kind: 'fade', label: 'Fade', group: 'video', blurb: 'Fade the picture and sound in and out.' },
  { kind: 'loop', label: 'Loop', group: 'video', blurb: 'Play the whole file again, several times.' },
  { kind: 'volume', label: 'Volume', group: 'video', blurb: 'Louder or quieter, picture untouched.' },
```

Audio group, after `loudness`:

```ts
  { kind: 'merge-audio', label: 'Merge', group: 'audio', blurb: 'Join songs, with a crossfade between them.' },
  { kind: 'audio-fade', label: 'Fade', group: 'audio', blurb: 'Fade the sound in and out.' },
  { kind: 'audio-loop', label: 'Loop', group: 'audio', blurb: 'Play the file again, several times.' },
  { kind: 'audio-volume', label: 'Volume', group: 'audio', blurb: 'Louder or quieter.' },
```

- [ ] **Step 2: Availability**

In `shared/src/availability.ts`, add cases before the closing of the switch:

```ts
    // Merging joins pictures; the audio version is its own operation.
    case 'merge':
      return hasVideo
        ? AVAILABLE
        : no('This file has no picture, and joining songs is a different operation.', 'merge-audio');

    case 'merge-audio':
      if (!hasAudio) return no('This file has no sound to join.', null);
      return hasVideo
        ? no('This would drop the picture, which is what Merge is for.', 'merge')
        : AVAILABLE;

    case 'add-music':
      return hasVideo
        ? AVAILABLE
        : no('There is no picture here to put music under. Extract the audio and merge songs instead.', null);

    case 'watermark':
      return hasVideo ? AVAILABLE : no('There is no picture here to stamp.', null);

    // Fade is the whole clip: picture and sound together. Sound-only fading is
    // Audio fade, which also works on a video with the picture copied across.
    case 'fade':
      return hasVideo
        ? AVAILABLE
        : no('This file has nothing to fade but sound, which is Audio fade.', 'audio-fade');

    case 'audio-fade':
      return hasAudio ? AVAILABLE : no('This file has no sound to fade.', null);

    // Looping loops the whole file. Two routes to one result would rot the list.
    case 'loop':
      return hasVideo
        ? AVAILABLE
        : no('This file is audio only, so Audio loop is the operation you want.', 'audio-loop');

    case 'audio-loop':
      return !hasVideo && hasAudio
        ? AVAILABLE
        : no('This loops the whole file, picture and sound, which is Loop.', 'loop');

    case 'volume':
      return hasVideo
        ? AVAILABLE
        : no('This file is audio only, so Audio volume is the operation you want.', 'audio-volume');

    case 'audio-volume':
      if (!hasAudio) return no('This file has no sound to change.', null);
      return hasVideo
        ? no('Changing this file\'s volume keeps the picture, which is Volume.', 'volume')
        : AVAILABLE;
```

- [ ] **Step 3: Output names**

In `shared/src/output-name.ts`:

`outputExtension` gains:

```ts
    case 'merge':
      // A merge is a new composition and owns its container: mp4 everywhere.
      return '.mp4';
    case 'merge-audio':
      return '.m4a';
    case 'add-music':
    case 'watermark':
    case 'fade':
    case 'loop':
    case 'volume':
    case 'audio-fade':
    case 'audio-loop':
    case 'audio-volume':
      return splitPath(sourcePath).ext || '.mp4';
```

`operationSuffix` gains:

```ts
    case 'merge':
      // The number of clips and the fade carry the settings; the stems would
      // overflow a filename on three clips.
      return `merge-${String(op.clipIds.length + 1)}-clips-${stamp(op.crossfadeSec)}`;
    case 'merge-audio':
      return `mix-${String(op.clipIds.length + 1)}-tracks-${stamp(op.crossfadeSec)}`;
    case 'add-music':
      // The song's stem names the mix; ids are meaningless in a downloads folder.
      return 'music';
    case 'watermark':
      return 'watermarked';
    case 'fade':
    case 'audio-fade':
      return `fade-${stamp(op.fadeInSec)}-${stamp(op.fadeOutSec)}`;
    case 'loop':
    case 'audio-loop':
      return `loop-${String(op.times)}x`;
    case 'volume':
    case 'audio-volume':
      // A minus sign in a filename reads as a separator, so the sign is a letter.
      return `volume-${op.gainDb < 0 ? `m${String(Math.abs(op.gainDb))}` : `p${String(op.gainDb)}`}db`;
```

- [ ] **Step 4: The shared tests, written red**

Create `shared/src/merge-suite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildArgs } from './build-args.js';
import type { ProbeResult } from './probe.js';

/** 3s 320x180 with audio, the e2e fixture's shape. */
function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id: 'src',
    path: '/work/.tmp/a-3036c17e.mp4',
    displayName: 'a.mp4',
    durationSec: 3,
    sizeBytes: 47_000,
    bitrate: null,
    video: { codec: 'h264', width: 320, height: 180, fps: 30 },
    audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
    ...overrides,
  };
}

const B = {
  path: '/work/.tmp/b-7d2c.mp4',
  meta: probe({ id: 'b', path: '/work/.tmp/b-7d2c.mp4', displayName: 'b.mp4', durationSec: 4 }),
};

const C = {
  path: '/work/.tmp/c-1f9a.mp4',
  meta: probe({ id: 'c', path: '/work/.tmp/c-1f9a.mp4', displayName: 'c.mp4', durationSec: 5 }),
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
    expect(plan.passes[0]?.argv.join(' ')).toContain('acrossfade=d=0.5:o=2.5');
    // Output runs for 3 + 4 - 0.5 = 6.5 seconds.
    expect(plan.passes[0]?.outputDurationSec).toBe(6.5);
  });

  it('accumulates the offsets across three clips', () => {
    const plan = buildArgs(
      { kind: 'merge', clipIds: ['b', 'c'], crossfadeSec: 1, fadeInSec: 0, fadeOutSec: 0, crf: 20 },
      probe(),
      io([B, C]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    // Second junction: 3 + 4 - 2 = 5.
    expect(argv).toContain('xfade=transition=fade:duration=1:offset=5');
    expect(plan.passes[0]?.outputDurationSec).toBe(10);
  });

  it('normalizes every clip to the first one, even dimensions included', () => {
    const odd = probe({ id: 'b', path: '/work/.tmp/b-7d2c.mp4', displayName: 'b.mp4' });
    const wide = {
      path: '/work/.tmp/b-7d2c.mp4',
      meta: {
        ...odd,
        video: { ...(odd.video ?? null), width: 641, height: 361, fps: 25 },
      },
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
    const silent = { path: B.path, meta: { ...probe(), audio: null, id: 'b', path: B.path } };
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
      probe(),
      io([B]),
    );
    const argv = plan.passes[0]?.argv.join(' ') ?? '';
    expect(argv).toContain('acrossfade=d=2:o=1');
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
        probe(),
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
```

- [ ] **Step 5: Run the tests, watch them fail**

Run: `npm run test --workspace @scrub/shared 2>&1 | tail -5`
Expected: the new file fails to even import: `buildArgs` exists, but `io.secondaryInputs` is not a field and the builders do not exist, so the failures are "property does not exist" and "not a function". Red either way, which is the point.

- [ ] **Step 6: Extend CommandIo and buildArgs**

In `shared/src/build-args.ts`:

```ts
export type CommandIo = {
  readonly inputPath: string;
  readonly outputPath: string;
  /** Scratch directory for intermediates, e.g. the GIF palette PNG. */
  readonly workDir: string;
  /** Second input, for the one operation that takes one: replace-audio. */
  readonly secondaryInputPath?: string;
  /**
   * Ordered extra inputs for the multi-input operations. Each carries its own
   * probe, because merge's offsets and normalization are arithmetic on the
   * *other* files' durations and streams, not on the loaded one's.
   */
  readonly secondaryInputs?: readonly { readonly path: string; readonly meta: ProbeResult }[];
};
```

Add the switch cases (import the builders):

```ts
    case 'merge':
      return buildMerge(op, meta, io);
    case 'merge-audio':
      return buildMergeAudio(op, meta, io);
    case 'add-music':
      return buildAddMusic(op, meta, io);
    case 'watermark':
      return buildWatermark(op, meta, io);
    case 'fade':
      return buildFade(op, meta, io);
    case 'audio-fade':
      return buildAudioFade(op, meta, io);
    case 'loop':
      return buildLoop(op, meta, io);
    case 'audio-loop':
      return buildAudioLoop(op, meta, io);
    case 'volume':
      return buildVolume(op, meta, io);
    case 'audio-volume':
      return buildAudioVolume(op, meta, io);
```

- [ ] **Step 7: The builders**

Append to `shared/src/build-operations.ts` (imports: `AudioMerge`, `AudioFade`, `AudioLoop`, `AudioVolume`, `VideoAddMusic`, `VideoFade`, `VideoLoop`, `VideoMerge`, `VideoVolume`, `VideoWatermark`, `WatermarkPosition`):

```ts
/* ─── The merge suite ───────────────────────────────────────────────────── */

/** The extras an operation was given, or a refusal it cannot run without them. */
export function secondaryMetas(
  io: CommandIo,
  operation: string,
): readonly { readonly path: string; readonly meta: ProbeResult }[] {
  if (io.secondaryInputs === undefined) {
    throw new InvalidOperation(operation, 'the extra files were not provided');
  }
  return io.secondaryInputs;
}

/** The container an output path implies, from its extension. */
export function containerFromPath(outputPath: string): VideoContainer | null {
  const ext = outputPath.toLowerCase().match(/\.(\w+)$/)?.[1];
  if (ext === 'mp4') return 'mp4';
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv') return 'mkv';
  if (ext === 'mov') return 'mov';
  return null;
}

/** xfade and acrossfade share one offset rule: each overlap starts where the
    previous clip ends, minus this overlap. Accumulated, not per-pair. */
function crossfadeOffsets(durations: readonly number[], fade: number): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (let i = 0; i < durations.length - 1; i++) {
    offsets.push(cursor + durations[i] - fade);
    cursor = offsets[offsets.length - 1] ?? 0;
  }
  return offsets;
}

/** The joined length: everything added up, minus one fade per junction. */
function joinedDuration(durations: readonly number[], fade: number): number {
  return durations.reduce((sum, value) => sum + value, 0) - fade * (durations.length - 1);
}
```

Then the builders:

```ts
export function buildMerge(op: VideoMerge, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'merge');
  const clips = [meta, ...extras.map((extra) => extra.meta)];
  if (clips.some((clip) => clip.video === null)) {
    throw new InvalidOperation('merge', 'every clip must have a picture');
  }
  const first = clips[0]?.video;
  if (!first) throw new InvalidOperation('merge', 'the first clip has no picture');
  if (clips.length < 2) throw new InvalidOperation('merge', 'merge needs at least two clips');

  // xfade demands identical geometry and constant frame rate, so everything is
  // normalized to the first clip. Even numbers: libx264 refuses odd ones.
  const w = first.width - (first.width % 2);
  const h = first.height - (first.height % 2);
  const fps = first.fps ?? 30;
  const fade = op.crossfadeSec;
  const rate = clips[0]?.audio?.sampleRate ?? 48_000;
  const durations = clips.map((clip) => clip.durationSec);
  const offsets = crossfadeOffsets(durations, fade);
  const total = joinedDuration(durations, fade);

  const paths = [io.inputPath, ...extras.map((extra) => extra.path)];
  const video: string[] = [];
  const audio: string[] = [];
  let lastVideo = '[v0]';
  let lastAudio = '[a0]';

  clips.forEach((clip, i) => {
    if (i === 0) {
      video.push(`[0:v]scale=${String(w)}:${String(h)},setsar=1,fps=${String(fps)}[v0]`);
      // A clip with no audio gets silence of exactly its length, so the chain
      // stays continuous and the picture never loses its place.
      audio.push(
        clip.audio === null
          ? `anullsrc=r=${String(rate)}:d=${String(durations[0])}[a0]`
          : `[0:a]aresample=${String(rate)}[a0]`,
      );
      return;
    }
    const offset = offsets[i - 1] ?? 0;
    video.push(
      `[${String(i)}:v]scale=${String(w)}:${String(h)},setsar=1,fps=${String(fps)}[v${String(i)}]`,
    );
    video.push(
      `[v${String(i - 1)}][v${String(i)}]xfade=transition=fade:duration=${String(fade)}:offset=${String(offset)}[xv${String(i)}]`,
    );
    lastVideo = `[xv${String(i)}]`;
    audio.push(
      clip.audio === null
        ? `anullsrc=r=${String(rate)}:d=${String(durations[i] ?? 0)}[a${String(i)}]`
        : `[${String(i)}:a]aresample=${String(rate)}[a${String(i)}]`,
    );
    audio.push(
      `[a${String(i - 1)}][a${String(i)}]acrossfade=d=${String(fade)}:o=${String(offset)}[xa${String(i)}]`,
    );
    lastAudio = `[xa${String(i)}]`;
  });

  if (op.fadeInSec > 0) {
    video.push(`${lastVideo}fade=t=in:st=0:d=${String(op.fadeInSec)}[vfin]`);
    audio.push(`${lastAudio}afade=t=in:st=0:d=${String(op.fadeInSec)}[afin]`);
    lastVideo = '[vfin]';
    lastAudio = '[afin]';
  }
  if (op.fadeOutSec > 0) {
    video.push(
      `${lastVideo}fade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[vout]`,
    );
    audio.push(
      `${lastAudio}afade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[aout]`,
    );
    lastVideo = '[vout]';
    lastAudio = '[aout]';
  }

  return {
    passes: [
      {
        label: 'Merge',
        outputDurationSec: total,
        argv: [
          ...TRANSPORT_ARGS,
          ...paths.flatMap((path) => ['-i', path]),
          '-filter_complex',
          [...video, ...audio].join(';'),
          '-map',
          lastVideo,
          '-map',
          lastAudio,
          '-c:v',
          'libx264',
          '-crf',
          String(op.crf),
          '-preset',
          'medium',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildMergeAudio(op: AudioMerge, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'merge-audio');
  const clips = [meta, ...extras.map((extra) => extra.meta)];
  if (clips.some((clip) => clip.audio === null)) {
    throw new InvalidOperation('merge-audio', 'every file must have sound to join');
  }
  if (clips.some((clip) => clip.video !== null)) {
    throw new InvalidOperation(
      'merge-audio',
      'joining songs keeps no picture; use Merge for video',
    );
  }
  if (clips.length < 2) throw new InvalidOperation('merge-audio', 'join needs at least two files');

  const rate = clips[0]?.audio?.sampleRate ?? 48_000;
  const durations = clips.map((clip) => clip.durationSec);
  const offsets = crossfadeOffsets(durations, op.crossfadeSec);
  const total = joinedDuration(durations, op.crossfadeSec);
  const paths = [io.inputPath, ...extras.map((extra) => extra.path)];

  const chain: string[] = [];
  let last = '[a0]';
  clips.forEach((clip, i) => {
    if (i === 0) {
      chain.push(`[0:a]aresample=${String(rate)}[a0]`);
      return;
    }
    const offset = offsets[i - 1] ?? 0;
    chain.push(`[${String(i)}:a]aresample=${String(rate)}[a${String(i)}]`);
    chain.push(
      `[a${String(i - 1)}][a${String(i)}]acrossfade=d=${String(op.crossfadeSec)}:o=${String(offset)}[xa${String(i)}]`,
    );
    last = `[xa${String(i)}]`;
  });
  if (op.fadeInSec > 0) {
    chain.push(`${last}afade=t=in:st=0:d=${String(op.fadeInSec)}[afin]`);
    last = '[afin]';
  }
  if (op.fadeOutSec > 0) {
    chain.push(
      `${last}afade=t=out:st=${String(total - op.fadeOutSec)}:d=${String(op.fadeOutSec)}[aout]`,
    );
    last = '[aout]';
  }

  return {
    passes: [
      {
        label: 'Merge audio',
        outputDurationSec: total,
        argv: [
          ...TRANSPORT_ARGS,
          ...paths.flatMap((path) => ['-i', path]),
          '-filter_complex',
          chain.join(';'),
          '-map',
          last,
          '-c:a',
          'aac',
          '-b:a',
          `${String(op.bitrateKbps)}k`,
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAddMusic(op: VideoAddMusic, meta: ProbeResult, io: CommandIo): CommandPlan {
  const extras = secondaryMetas(io, 'add-music');
  const music = extras[0];
  if (!music || music.meta.audio === null) {
    throw new InvalidOperation('add-music', 'the music file has no sound');
  }

  // The picture is copied bit for bit; only the mix is encoded. Without audio
  // of its own, the music alone becomes the track.
  const filter =
    meta.audio === null
      ? `[1:a]volume=${String(op.musicPercent / 100)}[aout]`
      : `[0:a]volume=${String(op.originalPercent / 100)}[a0];[1:a]volume=${String(op.musicPercent / 100)}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]`;

  return {
    passes: [
      {
        label: 'Add music',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-i',
          music.path,
          '-filter_complex',
          filter,
          '-map',
          '0:v:0',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

const WATERMARK_XY: Record<WatermarkPosition, string> = {
  nw: '10:10',
  n: '(W-w)/2:10',
  ne: 'W-w-10:10',
  w: '10:(H-h)/2',
  center: '(W-w)/2:(H-h)/2',
  e: 'W-w-10:(H-h)/2',
  sw: '10:H-h-10',
  s: '(W-w)/2:H-h-10',
  se: 'W-w-10:H-h-10',
};

export function buildWatermark(op: VideoWatermark, meta: ProbeResult, io: CommandIo): CommandPlan {
  const source = meta.video;
  if (source === null) throw new InvalidOperation('watermark', 'this file has no picture to stamp');
  const extras = secondaryMetas(io, 'watermark');
  const image = extras[0];
  if (!image) throw new InvalidOperation('watermark', 'no image was provided');

  // The mark is capped at a quarter of the frame so it never takes over, and
  // must not be upscaled past its own size.
  const cap = Math.floor(source.width / 4);
  const filter = `[1:v]scale=min(iw\\,${String(cap)}):-2,format=rgba,colorchannelmixer=aa=${String(op.opacity / 100)}[wm];[0:v][wm]overlay=${WATERMARK_XY[op.position]}[vout]`;

  const codecs = CODEC_MAP[containerFromPath(io.outputPath) ?? 'mp4'];

  return {
    passes: [
      {
        label: 'Watermark',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-i',
          image.path,
          '-filter_complex',
          filter,
          '-map',
          '[vout]',
          ...(meta.audio === null ? ['-an'] : ['-map', '0:a:0', '-c:a', 'copy']),
          '-c:v',
          codecs.video,
          '-crf',
          '20',
          '-preset',
          'medium',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildFade(op: VideoFade, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (op.fadeInSec <= 0 && op.fadeOutSec <= 0) {
    throw new InvalidOperation('fade', 'both fades are zero, so there is nothing to fade');
  }
  const video: string[] = [];
  if (op.fadeInSec > 0) video.push(`fade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0)
    video.push(
      `fade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );

  const audio: string[] = [];
  if (op.fadeInSec > 0) audio.push(`afade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0)
    audio.push(
      `afade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );

  const codecs = CODEC_MAP[containerFromPath(io.outputPath) ?? 'mp4'];

  return {
    passes: [
      {
        label: 'Fade',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-vf',
          video.join(','),
          '-c:v',
          codecs.video,
          '-crf',
          '20',
          '-preset',
          'medium',
          ...(meta.audio === null
            ? ['-an']
            : ['-af', audio.join(','), '-c:a', codecs.audio, '-b:a', '192k']),
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioFade(op: AudioFade, meta: ProbeResult, io: CommandIo): CommandPlan {
  if (meta.audio === null)
    throw new InvalidOperation('audio-fade', 'this file has no sound to fade');
  if (op.fadeInSec <= 0 && op.fadeOutSec <= 0) {
    throw new InvalidOperation('audio-fade', 'both fades are zero, so there is nothing to fade');
  }
  const chain: string[] = [];
  if (op.fadeInSec > 0) chain.push(`afade=t=in:st=0:d=${String(op.fadeInSec)}`);
  if (op.fadeOutSec > 0)
    chain.push(
      `afade=t=out:st=${String(meta.durationSec - op.fadeOutSec)}:d=${String(op.fadeOutSec)}`,
    );

  return {
    passes: [
      {
        label: 'Fade audio',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          chain.join(','),
          ...(meta.video === null ? [] : ['-c:v', 'copy']),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildLoop(op: VideoLoop, meta: ProbeResult, io: CommandIo): CommandPlan {
  loopTimes(op.times, 'loop');
  return {
    passes: [
      {
        label: 'Loop',
        // Stream copy: instant, and byte-faithful. -stream_loop counts *extra*
        // plays, so "3 times" is 2 loops.
        outputDurationSec: meta.durationSec * op.times,
        argv: [
          ...TRANSPORT_ARGS,
          '-stream_loop',
          String(op.times - 1),
          '-i',
          io.inputPath,
          '-c',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioLoop(op: AudioLoop, meta: ProbeResult, io: CommandIo): CommandPlan {
  loopTimes(op.times, 'audio-loop');
  return {
    passes: [
      {
        label: 'Loop audio',
        outputDurationSec: meta.durationSec * op.times,
        argv: [
          ...TRANSPORT_ARGS,
          '-stream_loop',
          String(op.times - 1),
          '-i',
          io.inputPath,
          '-c',
          'copy',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

function loopTimes(times: number, operation: string): void {
  if (!Number.isInteger(times) || times < 2 || times > 16) {
    throw new InvalidOperation(operation, `loops must be between 2 and 16, got ${String(times)}`);
  }
}

export function buildVolume(op: VideoVolume, meta: ProbeResult, io: CommandIo): CommandPlan {
  gainCheck(op.gainDb, 'volume');
  return {
    passes: [
      {
        label: 'Volume',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-c:v',
          'copy',
          '-af',
          `volume=${String(op.gainDb)}dB`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

export function buildAudioVolume(op: AudioVolume, meta: ProbeResult, io: CommandIo): CommandPlan {
  gainCheck(op.gainDb, 'audio-volume');
  return {
    passes: [
      {
        label: 'Volume',
        outputDurationSec: meta.durationSec,
        argv: [
          ...TRANSPORT_ARGS,
          '-i',
          io.inputPath,
          '-af',
          `volume=${String(op.gainDb)}dB`,
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          OVERWRITE_ARG,
          io.outputPath,
        ],
      },
    ],
  };
}

function gainCheck(gainDb: number, operation: string): void {
  if (!Number.isFinite(gainDb) || gainDb < -20 || gainDb > 20 || gainDb === 0) {
    throw new InvalidOperation(
      operation,
      `gain must be between -20 and 20 dB and not zero, got ${String(gainDb)}`,
    );
  }
}
```

- [ ] **Step 8: Run the shared tests**

Run: `npm run test --workspace @scrub/shared`
Expected: all merge-suite tests PASS. Fix any snapshot mismatch by checking the math, never by weakening the assertion.

- [ ] **Step 9: Format and commit**

Run: `npx prettier --write shared/src/operations.ts shared/src/availability.ts shared/src/output-name.ts shared/src/build-args.ts shared/src/build-operations.ts shared/src/merge-suite.test.ts`

```bash
git add shared/
git commit -m "Add the merge suite to the shared layer: ten kinds, builders, offset math, tests"
```

---

### Task 2: The server: zod mirrors and id resolution

**Files:**

- Modify: `server/src/schemas.ts` (ten schema entries)
- Modify: `server/src/routes/run.ts` (resolve ids to `secondaryInputs`)

**Interfaces:**

- Consumes: the ten kinds from Task 1; `getFile`, `buildArgs`.
- Produces: `POST /run` accepting all ten operations; `io.secondaryInputs` populated server-side.

- [ ] **Step 1: The zod entries**

In `server/src/schemas.ts`, before the closing `]) satisfies z.ZodType<Operation>;`:

```ts
  z.object({
    kind: z.literal('merge'),
    clipIds: z.array(idSchema).min(1).max(3),
    crossfadeSec: z.number().min(0).max(2),
    fadeInSec: z.number().min(0).max(5),
    fadeOutSec: z.number().min(0).max(5),
    crf: z.number().int().min(0).max(51),
  }),
  z.object({
    kind: z.literal('merge-audio'),
    clipIds: z.array(idSchema).min(1).max(11),
    crossfadeSec: z.number().min(0).max(10),
    fadeInSec: z.number().min(0).max(30),
    fadeOutSec: z.number().min(0).max(30),
    bitrateKbps: z.number().int().min(32).max(320),
  }),
  z.object({
    kind: z.literal('add-music'),
    musicId: idSchema,
    originalPercent: z.number().int().min(0).max(100),
    musicPercent: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('watermark'),
    imageId: idSchema,
    position: z.enum(['nw', 'n', 'ne', 'w', 'center', 'e', 'sw', 's', 'se']),
    opacity: z.number().int().min(0).max(100),
  }),
  z.object({
    kind: z.literal('fade'),
    fadeInSec: z.number().min(0).max(10),
    fadeOutSec: z.number().min(0).max(10),
  }),
  z.object({
    kind: z.literal('audio-fade'),
    fadeInSec: z.number().min(0).max(10),
    fadeOutSec: z.number().min(0).max(10),
  }),
  z.object({ kind: z.literal('loop'), times: z.number().int().min(2).max(16) }),
  z.object({ kind: z.literal('audio-loop'), times: z.number().int().min(2).max(16) }),
  z.object({ kind: z.literal('volume'), gainDb: z.number().min(-20).max(20) }),
  z.object({ kind: z.literal('audio-volume'), gainDb: z.number().min(-20).max(20) }),
```

- [ ] **Step 2: Resolve the ids in run.ts**

In `server/src/routes/run.ts`, replace the replace-audio resolution block (lines 116-129) with a resolution that covers all the secondary-input operations. Import `ProbeResult` from `@scrub/shared`:

```ts
let secondaryInputPath: string | undefined;
let secondaryInputs: readonly { readonly path: string; readonly meta: ProbeResult } | undefined;

const resolve = (id: string, missing: string) => {
  const file = getFile(id);
  if (!file?.meta) {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: missing },
    } satisfies ApiError);
    return null;
  }
  return { path: file.path, meta: file.meta };
};

if (op.kind === 'replace-audio') {
  const replacement = resolve(op.audioId, 'That replacement audio file is no longer loaded.');
  if (replacement === null) return;
  secondaryInputPath = replacement.path;
} else if (op.kind === 'merge' || op.kind === 'merge-audio') {
  const files = op.clipIds.map((clipId) =>
    resolve(clipId, 'One of those clips is no longer loaded. Add it again.'),
  );
  if (files.some((file) => file === null)) return;
  secondaryInputs = files.filter((file) => file !== null);
} else if (op.kind === 'add-music') {
  const music = resolve(op.musicId, 'That music file is no longer loaded.');
  if (music === null) return;
  secondaryInputs = [music];
} else if (op.kind === 'watermark') {
  const image = resolve(op.imageId, 'That image is no longer loaded.');
  if (image === null) return;
  secondaryInputs = [image];
}
```

And pass it into buildArgs:

```ts
const plan = buildArgs(op, source.meta, {
  inputPath: source.path,
  outputPath,
  workDir: config.tmpDir,
  ...(secondaryInputPath === undefined ? {} : { secondaryInputPath }),
  ...(secondaryInputs === undefined ? {} : { secondaryInputs }),
});
```

- [ ] **Step 3: Typecheck and the server tests**

Run: `npm run typecheck && npm run test --workspace @scrub/server`
Expected: green. `operationSchema satisfies z.ZodType<Operation>` catches any drift from Task 1.

- [ ] **Step 4: Format and commit**

Run: `npx prettier --write server/src/schemas.ts server/src/routes/run.ts`

```bash
git add server/src/schemas.ts server/src/routes/run.ts
git commit -m "Teach the server the merge suite: zod mirrors and secondary input resolution"
```

---

### Task 3: The store: params for ten operations

**Files:**

- Modify: `client/src/store/use-scrub-store.ts`

**Interfaces:**

- Consumes: `ProbeResult` (already imported).
- Produces: `OperationParams` entries `merge`, `mergeAudio`, `addMusic`, `watermark`, `fade`, `audioFade`, `loop`, `audioLoop`, `volume`, `audioVolume`, with defaults; session-only entries dropped by `loadParams`/`saveParams` exactly like `replaceAudio`.

- [ ] **Step 1: The param types**

Add to the `OperationParams` type (after `loudness`):

```ts
  readonly merge: {
    /** Ids of the extra clips, in order. The loaded file is clip 0. */
    readonly clipIds: readonly string[];
    /** The extras' resolved facts, for the client-side preview buildArgs call. */
    readonly clips: readonly {
      readonly id: string;
      readonly name: string;
      readonly path: string;
      readonly meta: ProbeResult;
    }[];
    readonly crossfadeSec: number;
    readonly fadeInSec: number;
    readonly fadeOutSec: number;
    readonly crf: number;
    /** Set while an extra clip is uploading, or when one failed. */
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly mergeAudio: {
    readonly clipIds: readonly string[];
    readonly clips: readonly { readonly id: string; readonly name: string; readonly path: string; readonly meta: ProbeResult }[];
    readonly crossfadeSec: number;
    readonly fadeInSec: number;
    readonly fadeOutSec: number;
    readonly bitrateKbps: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly addMusic: {
    readonly musicId: string | null;
    readonly musicName: string | null;
    readonly musicPath: string | null;
    readonly musicMeta: ProbeResult | null;
    readonly originalPercent: number;
    readonly musicPercent: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly watermark: {
    readonly imageId: string | null;
    readonly imageName: string | null;
    readonly imagePath: string | null;
    readonly imageMeta: ProbeResult | null;
    readonly position: WatermarkPosition;
    readonly opacity: number;
    readonly status: 'idle' | 'loading' | 'failed';
    readonly error: string | null;
  };
  readonly fade: { readonly fadeInSec: number; readonly fadeOutSec: number };
  readonly audioFade: { readonly fadeInSec: number; readonly fadeOutSec: number };
  readonly loop: { readonly times: number };
  readonly audioLoop: { readonly times: number };
  readonly volume: { readonly gainDb: number };
  readonly audioVolume: { readonly gainDb: number };
```

Import `WatermarkPosition` from `@scrub/shared` in the type import at the top.

- [ ] **Step 2: Defaults**

In `DEFAULT_PARAMS`, after `loudness`:

```ts
  merge: {
    clipIds: [],
    clips: [],
    crossfadeSec: 0.5,
    fadeInSec: 0,
    fadeOutSec: 0,
    crf: 20,
    status: 'idle',
    error: null,
  },
  mergeAudio: {
    clipIds: [],
    clips: [],
    crossfadeSec: 2,
    fadeInSec: 0,
    fadeOutSec: 0,
    bitrateKbps: 192,
    status: 'idle',
    error: null,
  },
  addMusic: {
    musicId: null,
    musicName: null,
    musicPath: null,
    musicMeta: null,
    originalPercent: 100,
    musicPercent: 35,
    status: 'idle',
    error: null,
  },
  watermark: {
    imageId: null,
    imageName: null,
    imagePath: null,
    imageMeta: null,
    position: 'se',
    opacity: 100,
    status: 'idle',
    error: null,
  },
  fade: { fadeInSec: 1, fadeOutSec: 1 },
  audioFade: { fadeInSec: 1, fadeOutSec: 1 },
  loop: { times: 2 },
  audioLoop: { times: 2 },
  volume: { gainDb: 6 },
  audioVolume: { gainDb: 6 },
```

- [ ] **Step 3: Session-only drops**

In `loadParams`, change the drop to reset every session-only entry:

```ts
return {
  ...(merged as OperationParams),
  replaceAudio: defaults.replaceAudio,
  merge: defaults.merge,
  mergeAudio: defaults.mergeAudio,
  addMusic: defaults.addMusic,
  watermark: defaults.watermark,
};
```

In `saveParams`, change the destructure the same way:

```ts
const {
  replaceAudio: _dropped1,
  merge: _dropped2,
  mergeAudio: _dropped3,
  addMusic: _dropped4,
  watermark: _dropped5,
  ...rest
} = params;
localStorage.setItem(PARAMS_KEY, JSON.stringify(rest));
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @scrub/client`
Expected: green. The client still does not render the new kinds, which typechecks fine because the switches have no exhaustiveness requirement there yet.

- [ ] **Step 5: Format and commit**

Run: `npx prettier --write client/src/store/use-scrub-store.ts`

```bash
git add client/src/store/use-scrub-store.ts
git commit -m "Give the store the merge suite params, session-only like replace-audio"
```

---

### Task 4: The command wiring: operationFor and the preview io

**Files:**

- Modify: `client/src/lib/use-command.ts` (ten operationFor cases, secondaryInputs in the io)

**Interfaces:**

- Consumes: the params from Task 3; `buildArgs`; `CommandIo.secondaryInputs`.
- Produces: the bar previews real merge/watermark commands and Run posts operations the server accepts.

- [ ] **Step 1: operationFor cases**

In `operationFor`, after the `loudness` case:

```ts
    case 'merge':
      return params.merge.clipIds.length === 0
        ? null
        : {
            kind,
            clipIds: params.merge.clipIds,
            crossfadeSec: params.merge.crossfadeSec,
            fadeInSec: params.merge.fadeInSec,
            fadeOutSec: params.merge.fadeOutSec,
            crf: params.merge.crf,
          };
    case 'merge-audio':
      return params.mergeAudio.clipIds.length === 0
        ? null
        : {
            kind,
            clipIds: params.mergeAudio.clipIds,
            crossfadeSec: params.mergeAudio.crossfadeSec,
            fadeInSec: params.mergeAudio.fadeInSec,
            fadeOutSec: params.mergeAudio.fadeOutSec,
            bitrateKbps: params.mergeAudio.bitrateKbps,
          };
    case 'add-music':
      return params.addMusic.musicId === null
        ? null
        : {
            kind,
            musicId: params.addMusic.musicId,
            originalPercent: params.addMusic.originalPercent,
            musicPercent: params.addMusic.musicPercent,
          };
    case 'watermark':
      return params.watermark.imageId === null
        ? null
        : {
            kind,
            imageId: params.watermark.imageId,
            position: params.watermark.position,
            opacity: params.watermark.opacity,
          };
    case 'fade':
      return { kind, fadeInSec: params.fade.fadeInSec, fadeOutSec: params.fade.fadeOutSec };
    case 'audio-fade':
      return { kind, fadeInSec: params.audioFade.fadeInSec, fadeOutSec: params.audioFade.fadeOutSec };
    case 'loop':
      return { kind, times: params.loop.times };
    case 'audio-loop':
      return { kind, times: params.audioLoop.times };
    case 'volume':
      return { kind, gainDb: params.volume.gainDb };
    case 'audio-volume':
      return { kind, gainDb: params.audioVolume.gainDb };
```

- [ ] **Step 2: The preview io**

In the `buildArgs` call inside `useCommand`, extend the io object after the `secondaryInputPath` spread:

```ts
        /**
         * The multi-input operations need the extras' paths AND probes, because
         * merge's offsets are arithmetic on the other files' durations. Same
         * call the server makes, same values.
         */
        ...(kind === 'merge'
          ? {
              secondaryInputs: params.merge.clips.map((clip) => ({
                path: clip.path,
                meta: clip.meta,
              })),
            }
          : kind === 'merge-audio'
            ? {
                secondaryInputs: params.mergeAudio.clips.map((clip) => ({
                  path: clip.path,
                  meta: clip.meta,
                })),
              }
            : kind === 'add-music' && params.addMusic.musicPath !== null && params.addMusic.musicMeta !== null
              ? {
                  secondaryInputs: [
                    { path: params.addMusic.musicPath, meta: params.addMusic.musicMeta },
                  ],
                }
              : kind === 'watermark' && params.watermark.imagePath !== null && params.watermark.imageMeta !== null
                ? {
                    secondaryInputs: [
                      { path: params.watermark.imagePath, meta: params.watermark.imageMeta },
                    ],
                  }
                : {}),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @scrub/client`
Expected: green.

- [ ] **Step 4: Format and commit**

Run: `npx prettier --write client/src/lib/use-command.ts`

```bash
git add client/src/lib/use-command.ts
git commit -m "Wire the merge suite into the command bar"
```

---

### Task 5: The Inputs card and the ten panels

**Files:**

- Create: `client/src/components/InputsCard.tsx`
- Create: `client/src/components/ComposeControls.tsx` (the ten panels)
- Modify: `client/src/components/OperationControls.tsx` (imports and switch cases)

**Interfaces:**

- Consumes: Field vocabulary (`Panel`, `Row`, `NumberField`, `Choice`, `Readout`, `Note`, `Legend`), `uploadFile`, `ApiError`, the params from Task 3.
- Produces: `InputsCard` (generic list editor for extra inputs), panels `Merge`, `MergeAudio`, `AddMusic`, `Watermark`, `Fade`, `AudioFade`, `Loop`, `AudioLoop`, `Volume`, `AudioVolume`, wired into `OperationControls`.

- [ ] **Step 1: The InputsCard component**

Create `client/src/components/InputsCard.tsx`:

```tsx
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useScrubStore } from '@/store/use-scrub-store';

export type InputsItem = {
  readonly id: string;
  readonly name: string;
};

type InputsCardProps = {
  /** What the list is, e.g. "Clips to join, in order". */
  readonly legend: string;
  /** What the drop zone says before anything is added. */
  readonly empty: string;
  /** The picker's accept list: "video/*", "audio/*", or "image/*". */
  readonly accept: string;
  readonly items: readonly InputsItem[];
  readonly max: number;
  readonly loading: string | null;
  readonly error: string | null;
  readonly onAdd: (file: File | undefined | null) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
};

/**
 * The extra inputs for the multi-input operations.
 *
 * The loaded file is always row 0 and is not part of this list; the card is
 * everything after it. Order matters for merge, which is the only reason the
 * arrows exist.
 */
export function InputsCard({
  legend,
  empty,
  accept,
  items,
  max,
  loading,
  error,
  onAdd,
  onRemove,
  onMove,
}: InputsCardProps) {
  const meta = useScrubStore((state) => state.meta);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = items.length >= max;

  return (
    <div>
      <p className="text-micro text-muted mb-2 tracking-wide">{legend}</p>
      <ol className="border-line overflow-hidden rounded-control border">
        {meta !== null && (
          <li className="border-line text-label text-ink flex items-center gap-2 border-b bg-surface/60 px-3 py-2 font-mono">
            <span className="text-micro text-muted w-4 shrink-0 text-right tabular-nums">1</span>
            <span className="truncate">{meta.displayName}</span>
            <span className="text-micro text-muted ml-auto shrink-0">loaded</span>
          </li>
        )}
        {items.map((item, index) => (
          <li
            key={item.id}
            className="border-line text-label text-ink flex items-center gap-2 border-b px-3 py-2 font-mono last:border-b-0"
          >
            <span className="text-micro text-muted w-4 shrink-0 text-right tabular-nums">
              {String(index + 2)}
            </span>
            <span className="truncate">{item.name}</span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={`Move ${item.name} up`}
                disabled={index === 0}
                onClick={() => {
                  onMove(item.id, -1);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100 disabled:opacity-30"
              >
                <ArrowUp aria-hidden size={13} />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.name} down`}
                disabled={index === items.length - 1}
                onClick={() => {
                  onMove(item.id, 1);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100 disabled:opacity-30"
              >
                <ArrowDown aria-hidden size={13} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => {
                  onRemove(item.id);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100"
              >
                <X aria-hidden size={13} />
              </button>
            </div>
          </li>
        ))}
      </ol>

      {!full && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => {
            setOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOver(false);
            onAdd(event.dataTransfer.files[0]);
          }}
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed px-6 py-3 text-center transition-colors duration-100',
            over ? 'border-accent bg-accent/[0.06]' : 'border-line-strong',
          )}
        >
          <p className="text-label text-muted">
            {loading !== null ? `Loading ${loading}` : items.length === 0 ? empty : 'Add another'}
          </p>
        </div>
      )}
      {error !== null && <p className="text-micro text-accent mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onAdd(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: The panels file, part 1: merge and merge audio**

Create `client/src/components/ComposeControls.tsx` with the shared upload helper at the top:

```tsx
import {
  formatTimecode as formatSeconds,
  type ProbeResult,
  type WatermarkPosition,
} from '@scrub/shared';

import { ApiError, uploadFile } from '@/lib/api';
import { InputsCard } from '@/components/InputsCard';
import { Choice, Note, NumberField, Panel, Readout, Row } from '@/components/controls/Field';
import { useScrubStore } from '@/store/use-scrub-store';
```

Merge panel:

```tsx
export function Merge({ meta }: { readonly meta: ProbeResult }) {
  const merge = useScrubStore((state) => state.params.merge);
  const setParams = useScrubStore((state) => state.setParams);

  const add = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('merge', { status: 'loading', error: null });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.video === null) {
          setParams('merge', {
            status: 'failed',
            error: 'That file has no picture. Joining songs is the Merge in the Audio group.',
          });
          return;
        }
        const clips = [...merge.clips];
        clips.push({
          id: result.id,
          name: result.meta.displayName,
          path: result.meta.path,
          meta: result.meta,
        });
        setParams('merge', {
          status: 'idle',
          error: null,
          clips,
          clipIds: clips.map((clip) => clip.id),
        });
      })
      .catch((error: unknown) => {
        setParams('merge', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
        });
      });
  };

  const remove = (id: string): void => {
    const clips = merge.clips.filter((clip) => clip.id !== id);
    setParams('merge', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const move = (id: string, direction: -1 | 1): void => {
    const index = merge.clips.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= merge.clips.length) return;
    const clips = [...merge.clips];
    const [moved] = clips.splice(index, 1);
    if (!moved) return;
    clips.splice(target, 0, moved);
    setParams('merge', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const total =
    merge.clips.reduce((sum, clip) => sum + clip.meta.durationSec, meta.durationSec) -
    merge.crossfadeSec * merge.clips.length;

  return (
    <Panel>
      <InputsCard
        legend="Clips to join, in order"
        empty="Drop or click to add a clip. The loaded file goes first."
        accept="video/*"
        items={merge.clips.map((clip) => ({ id: clip.id, name: clip.name }))}
        max={3}
        loading={merge.status === 'loading' ? '' : null}
        error={merge.error}
        onAdd={add}
        onRemove={remove}
        onMove={move}
      />

      <Row>
        <NumberField
          label="Crossfade"
          value={merge.crossfadeSec}
          min={0}
          max={2}
          step={0.1}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { crossfadeSec: Math.round(value * 10) / 10 });
          }}
          ticks={[
            { at: 0, label: 'hard cut' },
            { at: 0.5, label: 'gentle' },
            { at: 2, label: 'long' },
          ]}
          meaning={
            merge.crossfadeSec === 0
              ? 'Each clip starts the instant the last one ends.'
              : 'Each clip fades into the next over this long.'
          }
        />
        <NumberField
          label="Quality"
          value={merge.crf}
          min={16}
          max={30}
          suffix="CRF"
          onChange={(value) => {
            setParams('merge', { crf: Math.round(value) });
          }}
          meaning="Lower keeps more detail. Joining clips always re-encodes the picture."
        />
      </Row>

      <Row>
        <NumberField
          label="Fade in"
          value={merge.fadeInSec}
          min={0}
          max={5}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { fadeInSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined result in from black and silence. 0 means none."
        />
        <NumberField
          label="Fade out"
          value={merge.fadeOutSec}
          min={0}
          max={5}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { fadeOutSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined result out. 0 means none."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Clips',
            from: `${String(merge.clips.length + 1)} of up to 4`,
            to: merge.clips.length === 0 ? 'add at least one more' : 'joined',
          },
          { label: 'Length', from: formatSeconds(meta.durationSec), to: formatSeconds(total) },
          {
            label: 'Picture',
            from: 'several sizes',
            to: `${String(meta.video?.width ?? 0)} × ${String(meta.video?.height ?? 0)}, matched to the first clip`,
          },
        ]}
      />

      <Note>
        Every clip is matched to the first one: same size, same frame rate, same audio rate. The
        picture is re-encoded at your quality setting, which a join always needs, and the sound is
        crossfaded to match.
      </Note>
    </Panel>
  );
}
```

MergeAudio panel: the same shape with the `mergeAudio` params key, `accept="audio/*"`, `max={11}`, crossfade `min={0} max={10}` with ticks at 0 'hard cut', 2 'gentle', 6 'long', the refusal message 'That file has a picture. Joining clips is the Merge in the Video group.', and this bitrate field in place of the crf one:

```tsx
<NumberField
  label="Bitrate"
  value={mergeAudio.bitrateKbps}
  min={64}
  max={320}
  step={32}
  suffix="kbps"
  onChange={(value) => {
    setParams('mergeAudio', { bitrateKbps: Math.round(value / 32) * 32 });
  }}
  ticks={[
    { at: 128, label: 'fine for speech' },
    { at: 192, label: 'good' },
    { at: 288, label: 'transparent' },
  ]}
  meaning="Joining songs always re-encodes the sound; this sets how much detail survives."
/>
```

The Readout's Picture line reads 'none, songs only'. The Note reads: 'Every file is matched to the first one\'s sample rate and crossfaded into the next. The result is an m4a with aac sound, saved next to the first file.'

- [ ] **Step 3: The panels file, part 2: add music and watermark**

AddMusic panel:

```tsx
export function AddMusic({ meta }: { readonly meta: ProbeResult }) {
  const music = useScrubStore((state) => state.params.addMusic);
  const setParams = useScrubStore((state) => state.setParams);

  const accept = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('addMusic', { status: 'loading', error: null, musicName: file.name });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.audio === null) {
          setParams('addMusic', {
            status: 'failed',
            error: 'That file has no sound in it.',
            musicId: null,
          });
          return;
        }
        setParams('addMusic', {
          status: 'idle',
          error: null,
          musicId: result.id,
          musicName: result.meta.displayName,
          musicPath: result.meta.path,
          musicMeta: result.meta,
        });
      })
      .catch((error: unknown) => {
        setParams('addMusic', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
          musicId: null,
        });
      });
  };

  return (
    <Panel>
      <InputsCard
        legend="The song"
        empty="Drop or click to add a music file."
        accept="audio/*"
        items={
          music.musicId === null || music.musicName === null
            ? []
            : [{ id: music.musicId, name: music.musicName }]
        }
        max={1}
        loading={music.status === 'loading' ? music.musicName : null}
        error={music.error}
        onAdd={accept}
        onRemove={() => {
          setParams('addMusic', {
            musicId: null,
            musicName: null,
            musicPath: null,
            musicMeta: null,
          });
        }}
        onMove={() => undefined}
      />

      <Row>
        <NumberField
          label="Your sound"
          value={music.originalPercent}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => {
            setParams('addMusic', { originalPercent: Math.round(value) });
          }}
          meaning="0 silences the original. The music can take over entirely."
        />
        <NumberField
          label="Music"
          value={music.musicPercent}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => {
            setParams('addMusic', { musicPercent: Math.round(value) });
          }}
          meaning="35 is a background hum; 100 is the song at full strength."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: `${meta.video?.codec ?? 'none'}, copied exactly`,
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'mixed together, as aac' },
          {
            label: 'Length',
            from: formatSeconds(meta.durationSec),
            to: "the video's length, the mix ends with the shorter side",
          },
        ]}
      />

      <Note>
        The picture is copied bit for bit; only the sound is mixed and encoded. The mix runs until
        the shorter of the two sounds ends.
      </Note>
    </Panel>
  );
}
```

Watermark panel: one `InputsCard` with `accept="image/*"`, max 1, plus a `Choice` for position with nine options (labels: 'Top left', 'Top centre', 'Top right', 'Left', 'Centre', 'Right', 'Bottom left', 'Bottom centre', 'Bottom right') and a `NumberField` for opacity 0-100 suffix '%', default 100. The `onAdd` refusal when `result.meta.video === null` reads 'That file is not an image Scrub can read.' Note text: 'The mark is capped at a quarter of the frame and re-encodes the picture at CRF 20. The sound copies untouched.'

- [ ] **Step 4: The panels file, part 3: fade, loop, volume, and the audio twins**

Fade and AudioFade share one body; Loop/AudioLoop share one; Volume/AudioVolume share one. Write them as six thin wrappers over three shared components:

```tsx
export function Fade({ meta }: { readonly meta: ProbeResult }) {
  return <FadeFields meta={meta} audioOnly={false} />;
}

export function AudioFade({ meta }: { readonly meta: ProbeResult }) {
  return <FadeFields meta={meta} audioOnly />;
}

function FadeFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioFade' : 'fade';
  const { fadeInSec, fadeOutSec } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Fade in"
          value={fadeInSec}
          min={0}
          max={10}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams(key, { fadeInSec: Math.round(value * 2) / 2 });
          }}
          meaning="Rises from black and silence over this long. 0 means none."
        />
        <NumberField
          label="Fade out"
          value={fadeOutSec}
          min={0}
          max={10}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams(key, { fadeOutSec: Math.round(value * 2) / 2 });
          }}
          meaning="Settles to black and silence over this long. 0 means none."
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: audioOnly ? 'copied, untouched' : 'faded, re-encoded',
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'faded, as aac' },
        ]}
      />
      <Note>
        {audioOnly
          ? 'Only the sound fades; the picture is copied across untouched.'
          : 'Picture and sound fade together, and both are re-encoded, because a fade is written into the pixels and the samples themselves.'}
      </Note>
    </Panel>
  );
}
```

Loop and AudioLoop share one body, and Volume and AudioVolume share one:

```tsx
export function Loop({ meta }: { readonly meta: ProbeResult }) {
  return <LoopFields meta={meta} audioOnly={false} />;
}

export function AudioLoop({ meta }: { readonly meta: ProbeResult }) {
  return <LoopFields meta={meta} audioOnly />;
}

function LoopFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioLoop' : 'loop';
  const { times } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Play it"
          value={times}
          min={2}
          max={16}
          suffix="times"
          onChange={(value) => {
            setParams(key, { times: Math.round(value) });
          }}
          ticks={[
            { at: 2, label: 'twice' },
            { at: 4, label: 'four times' },
            { at: 16, label: 'sixteen times' },
          ]}
          meaning={`The whole file plays ${String(times)} times in a row.`}
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Length',
            from: formatSeconds(meta.durationSec),
            to: formatSeconds(meta.durationSec * times),
          },
          { label: 'Picture', from: meta.video?.codec ?? 'none', to: 'copied, untouched' },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'copied, untouched' },
        ]}
      />
      <Note>
        No re-encoding at all: the file is copied once and played again. This finishes about as fast
        as copying it.
      </Note>
    </Panel>
  );
}

export function Volume({ meta }: { readonly meta: ProbeResult }) {
  return <VolumeFields meta={meta} audioOnly={false} />;
}

export function AudioVolume({ meta }: { readonly meta: ProbeResult }) {
  return <VolumeFields meta={meta} audioOnly />;
}

function VolumeFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioVolume' : 'volume';
  const { gainDb } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Gain"
          value={gainDb}
          min={-20}
          max={20}
          suffix="dB"
          onChange={(value) => {
            setParams(key, { gainDb: Math.round(value) });
          }}
          ticks={[
            { at: -12, label: 'much quieter' },
            { at: 6, label: 'a bit louder' },
            { at: 12, label: 'much louder' },
          ]}
          meaning={
            gainDb === 0
              ? 'No change at all, which would just waste an encode.'
              : gainDb > 0
                ? `Everything sounds ${String(gainDb)} dB louder, and the loudest parts may distort.`
                : `Everything sounds ${String(Math.abs(gainDb))} dB quieter.`
          }
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: audioOnly ? 'none' : 'copied, untouched',
          },
          {
            label: 'Sound',
            from: meta.audio?.codec ?? 'none',
            to: `as aac, ${gainDb > 0 ? '+' : ''}${String(gainDb)} dB`,
          },
        ]}
      />
      <Note>
        {audioOnly
          ? 'Only the sound is re-encoded, as aac 192k.'
          : 'The picture is copied bit for bit; only the sound is re-encoded, as aac 192k.'}
      </Note>
    </Panel>
  );
}
```

- [ ] **Step 5: Wire the switch**

In `OperationControls.tsx`, import the ten panels from `./ComposeControls` and add the cases:

```tsx
    case 'merge':
      return <Merge meta={meta} />;
    case 'merge-audio':
      return <MergeAudio meta={meta} />;
    case 'add-music':
      return <AddMusic meta={meta} />;
    case 'watermark':
      return <Watermark meta={meta} />;
    case 'fade':
      return <Fade meta={meta} />;
    case 'audio-fade':
      return <AudioFade meta={meta} />;
    case 'loop':
      return <Loop meta={meta} />;
    case 'audio-loop':
      return <AudioLoop meta={meta} />;
    case 'volume':
      return <Volume meta={meta} />;
    case 'audio-volume':
      return <AudioVolume meta={meta} />;
```

- [ ] **Step 6: Typecheck and a manual smoke**

Run: `npm run typecheck --workspace @scrub/client`
Expected: green. If the dev servers are running, load `/op/merge` in the browser and confirm the panel renders and the bar shows a skeleton until a second clip is added.

- [ ] **Step 7: Format and commit**

Run: `npx prettier --write client/src/components/InputsCard.tsx client/src/components/ComposeControls.tsx client/src/components/OperationControls.tsx`

```bash
git add client/src/components/InputsCard.tsx client/src/components/ComposeControls.tsx client/src/components/OperationControls.tsx
git commit -m "Add the Inputs card and the ten merge suite panels"
```

---

### Task 6: Save this frame

**Files:**

- Create: `client/src/lib/use-save-frame.ts`
- Modify: `client/src/components/MediaWell.tsx` (the button on the video well)

**Interfaces:**

- Consumes: `currentTime` from `@/lib/playback`, `startRun`, `subscribeToJob`, `cancelRun` from `@/lib/api`, `TRANSPORT_ARGS`, `OVERWRITE_ARG` from `@scrub/shared`, the store's `addJob`/`updateJob`/`meta`.
- Produces: `useSaveFrame()` returning `{ saving: boolean; save: () => void }`, used by a small button on the video well. The frame goes through the queue as a job with `kind: null` and title `Frame`.

- [ ] **Step 1: The hook**

Create `client/src/lib/use-save-frame.ts`:

```ts
import { OVERWRITE_ARG, TRANSPORT_ARGS } from '@scrub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, startRun, subscribeToJob } from '@/lib/api';
import { currentTime } from '@/lib/playback';
import { useScrubStore } from '@/store/use-scrub-store';

/** "1m04.5" - the frame's moment, filename-safe. */
function stamp(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  if (rounded < 60) return `${String(rounded)}s`;
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes)}m${String(Math.round((rounded - minutes * 60) * 10) / 10)}s`;
}

/**
 * Save the frame under the playhead as a lossless PNG, through the queue.
 *
 * This is a hand-built argv rather than an operation: it is one button, and the
 * closed operation list does not grow for a button. It rides the edited-command
 * path of POST /run, so it shows up in the queue and downloads like any result,
 * and it deliberately does not touch the foreground run state: grabbing a frame
 * must not disturb the operation being set up.
 */
export function useSaveFrame(): { readonly saving: boolean; readonly save: () => void } {
  const meta = useScrubStore((state) => state.meta);
  const uploadId = useScrubStore((state) => state.uploadId);
  const addJob = useScrubStore((state) => state.addJob);
  const updateJob = useScrubStore((state) => state.updateJob);
  const [saving, setSaving] = useState(false);
  const detachRef = useRef<(() => void) | null>(null);

  // Same lifecycle as use-run: the subscription dies with the component.
  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  const save = useCallback(() => {
    if (!meta || !uploadId || meta.video === null || saving) return;
    setSaving(true);

    const stem = meta.path.replace(/\.\w+$/, '');
    const outputPath = `${stem}-frame-${stamp(currentTime())}.png`;
    // The same prefix every operation carries, so progress reaches the bar.
    const argv = [
      ...TRANSPORT_ARGS,
      '-ss',
      String(currentTime()),
      '-i',
      meta.path,
      '-frames:v',
      '1',
      OVERWRITE_ARG,
      outputPath,
    ];

    startRun(uploadId, { argv })
      .then((jobId) => {
        addJob({
          jobId,
          kind: null,
          title: `Frame · ${meta.displayName}`,
          status: 'running',
          position: 0,
          progress: 0,
          determinate: false,
          etaMs: null,
          passLabel: '',
          elapsedMs: 0,
          outputId: null,
          outputName: null,
          sizeBytes: null,
          message: null,
        });
        detachRef.current = subscribeToJob(jobId, (event) => {
          // Mirror use-run.ts exactly, minus the foreground setRun: the frame
          // lives in the queue only, and must not disturb the operation being
          // set up.
          if (event.type === 'progress') {
            updateJob(jobId, {
              status: 'running',
              position: 0,
              progress: event.progress,
              determinate: event.determinate,
              etaMs: event.etaMs,
              passLabel: event.passLabel,
              elapsedMs: event.elapsedMs,
            });
            return;
          }
          if (event.type === 'done') {
            updateJob(jobId, {
              status: 'done',
              progress: 1,
              determinate: true,
              outputId: event.outputId,
              outputName: event.outputName,
              sizeBytes: event.sizeBytes,
              elapsedMs: event.elapsedMs,
            });
            setSaving(false);
            return;
          }
          if (event.type === 'error' || event.type === 'cancelled') setSaving(false);
        });
      })
      .catch((error: unknown) => {
        setSaving(false);
        // Nothing to surface: a frame grab is a side action, not the operation
        // on screen, and the queue chip stays honest about the job.
        if (!(error instanceof ApiError)) return;
      });
  }, [meta, uploadId, saving, addJob, updateJob]);

  return { saving, save };
}
```

- [ ] **Step 2: The button**

In `MediaWell.tsx`, the video branch's `Well` gains a header row. Import the hook and add inside `Well`:

```tsx
<Well>
  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-2">
    <button
      type="button"
      disabled={saving}
      onClick={() => {
        save();
      }}
      title="Save the frame under the playhead as a PNG"
      className="text-micro text-token-binary hover:bg-white/10 pointer-events-auto rounded-button px-2 py-1 transition-colors duration-100 disabled:opacity-40"
    >
      {saving ? 'Saving' : 'Save this frame'}
    </button>
  </div>
  ...video...
</Well>
```

The `Well` helper needs `saving` and `save` passed from `MediaWell` (call `useSaveFrame()` at the top of `MediaWell` and pass both down as props to `Well`). The well's container already has `relative` via... it does not; add `relative` to `Well`'s class list. The button must not steal the video's keyboard handling: it is outside the video element and only takes focus when clicked, same as the rest of the chrome.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @scrub/client`
Expected: green.

- [ ] **Step 4: Format and commit**

Run: `npx prettier --write client/src/lib/use-save-frame.ts client/src/components/MediaWell.tsx`

```bash
git add client/src/lib/use-save-frame.ts client/src/components/MediaWell.tsx
git commit -m "Save the frame under the playhead, through the queue"
```

---

### Task 7: Fixtures and end-to-end coverage

**Files:**

- Create: `e2e/fixtures/clip-b.mp4`, `e2e/fixtures/mark.png` (generated, committed)
- Modify: `e2e/flows.spec.ts`

**Interfaces:**

- Consumes: the app from Tasks 1-6, real ffmpeg.
- Produces: a passing suite proving every new operation runs end to end against real ffmpeg.

- [ ] **Step 1: Generate the fixtures**

Run (ffmpeg is installed on this machine, which the suite already requires):

```bash
ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=0x3366ff:s=320x180:r=30:d=3" -f lavfi -i "sine=frequency=660:duration=3" -shortest -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac e2e/fixtures/clip-b.mp4 -y
ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=0xff3366:s=64x64" -frames:v 1 e2e/fixtures/mark.png -y
ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=880:duration=4" -c:a aac e2e/fixtures/tone-b.m4a -y
```

Expected: `clip-b.mp4` (3s, 320x180, h264 + aac), `mark.png` (64x64), and `tone-b.m4a` (4s). The second tone exists because two uploads of the same file dedupe into one id by fingerprint, and a merge of one file twice proves nothing.

- [ ] **Step 2: The merge describe**

Append to `e2e/flows.spec.ts` (a helper first, near the other helpers):

```ts
const CLIP_B = path.join(FIXTURES, 'clip-b.mp4');
const MARK = path.join(FIXTURES, 'mark.png');
const TONE_B = path.join(FIXTURES, 'tone-b.m4a');

/** Adds an extra input inside the Inputs card's drop zone. */
async function addExtra(page: Page, filePath: string): Promise<void> {
  await page.setInputFiles('input[type=file]', filePath);
}
```

Note: the Inputs card's hidden input is the only `input[type=file]` on an operation route with a file loaded, because the dropzone is gone by then. That holds for every test below.

```ts
test.describe('the merge suite', () => {
  test('merges two clips with a crossfade', async ({ page }) => {
    await page.goto('/op/merge');
    await loadFixture(page);
    await addExtra(page, CLIP_B);

    await expect(page.locator('ol li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });

    // The bar showed the real graph: crossfade on both streams.
    const command = await commandText(page);
    expect(command).toContain('xfade=transition=fade');
    expect(command).toContain('acrossfade');
  });

  test('merges two songs', async ({ page }) => {
    await page.goto('/op/merge-audio');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });
    await addExtra(page, TONE_B);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
  });

  test('puts music under a video', async ({ page }) => {
    await page.goto('/op/add-music');
    await loadFixture(page);
    await addExtra(page, AUDIO_FIXTURE);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('amix=inputs=2');
  });

  test('stamps an image over the picture', async ({ page }) => {
    await page.goto('/op/watermark');
    await loadFixture(page);
    await addExtra(page, MARK);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('overlay=');
  });

  test('fades, loops, and turns the volume up', async ({ page }) => {
    await page.goto('/op/fade');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('fade=t=in');

    await page.goto('/op/loop');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('-stream_loop');

    await page.goto('/op/volume');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 120_000,
    });
    expect(await commandText(page)).toContain('volume=6dB');
  });

  test('points audio files at the audio variants', async ({ page }) => {
    await page.goto('/op/merge');
    await page.setInputFiles('input[type=file]', AUDIO_FIXTURE);
    await expect(page.locator('audio')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Joining songs/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Merge audio/i })).toBeVisible();
  });

  test('saves the frame under the playhead', async ({ page }) => {
    await page.goto('/');
    await loadFixture(page);
    await page.getByRole('button', { name: 'Save this frame' }).click();
    await expect(page.getByRole('link', { name: 'Save', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    // The queue recorded it as a Frame job.
    await expect(page.getByText(/Frame ·/)).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the new block**

Run: `npx playwright test e2e/flows.spec.ts --grep "merge suite"`
Expected: all 6 pass.

- [ ] **Step 4: The full suite**

Run: `npx playwright test`
Expected: 65 passed (59 + 6). Fix any selector collisions (the queue chip Save links and the result panel Save are already distinguished by the existing tests' patterns; the new tests reuse them).

- [ ] **Step 5: Format and commit**

Run: `npx prettier --write e2e/flows.spec.ts`

```bash
git add e2e/flows.spec.ts e2e/fixtures/clip-b.mp4 e2e/fixtures/mark.png e2e/fixtures/tone-b.m4a
git commit -m "Prove the merge suite end to end against real ffmpeg"
```

---

### Task 8: Docs, and the final gate

**Files:**

- Modify: `docs/OPERATIONS.md` (an entry per operation, with the traps: offset arithmetic, `-stream_loop` counting, anullsrc splice, codec map reuse, the copy discipline table)
- Modify: `docs/CLAUDE.md` (the closed list line and the deferred line, if either names the operation list)
- Modify: `docs/superpowers/specs/2026-09-16-merge-suite-design.md` (only if implementation deviated; record deviations instead of silently editing)

- [ ] **Step 1: OPERATIONS.md**

Add a `## The merge suite` section documenting each operation's exact command shape, the offset rule, and why: crossfade offsets accumulate, `-stream_loop n` plays n+1 times, a clip without audio gets `anullsrc`, merge owns the mp4 container, add-music copies the picture, watermark caps at a quarter frame and follows the codec map, the fades refuse the no-op, volume keeps the picture.

- [ ] **Step 2: CLAUDE.md**

The operations list line becomes:

```
Video: trim (fast/precise), compress, fit a size, convert, resize, crop, speed, GIF,
extract audio, mute, replace audio, merge, add music, watermark, fade, loop, volume.
Audio: convert, trim, normalise loudness, merge, fade, loop, volume.
```

And the "Rules that are easy to get wrong" section gains one line:

- **Multi-input operations** carry upload ids in the operation; the server resolves them into `io.secondaryInputs` so buildArgs stays pure. Streams are copied unless ffmpeg forces a re-encode; forced re-encodes use the codec map and default to crf 20 / aac 192k.

- [ ] **Step 3: The full gate**

Run: `npm run verify`
Expected: green end to end: typecheck, lint, format:check, contrast, build, 163 + shared merge suite tests + server tests, 65 e2e.

- [ ] **Step 4: Commit**

```bash
git add docs/OPERATIONS.md docs/CLAUDE.md docs/superpowers/specs/2026-09-16-merge-suite-design.md
git commit -m "Document the merge suite"
```

---

## Definition of done

- All ten operations plus Save this frame work end to end against real ffmpeg, with the queue, progress, ETA, chaining, and downloads behaving exactly as they do for every existing operation.
- The command bar shows the real filter graph for merge, merge audio, add music, and watermark, built by the same `buildArgs` the server spawns.
- The copy discipline holds: loop and volume-on-video are stream copies; add-music copies the picture; only the streams ffmpeg forces are re-encoded, at crf 20 / aac 192k.
- `npm run verify` is green including the new shared tests and the six new e2e tests.
- The spec, plan, and docs live under `docs/`, everything committed, nothing pushed.
