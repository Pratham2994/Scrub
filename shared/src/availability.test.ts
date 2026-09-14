import { describe, expect, it } from 'vitest';

import { availabilityOf, isAvailable } from './availability.js';
import { buildArgs, type CommandIo } from './build-args.js';
import { InvalidOperation } from './errors.js';
import { OPERATIONS, type OperationKind } from './operations.js';
import type { ProbeResult } from './probe.js';

const base: ProbeResult = {
  path: '/work/.tmp/clip.mp4',
  displayName: 'clip.mp4',
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 60,
  sizeBytes: 5_000_000,
  bitrate: 666_666,
  video: { index: 0, codec: 'h264', width: 1920, height: 1080, fps: 30, pixelFormat: 'yuv420p' },
  audio: { index: 1, codec: 'aac', channels: 2, sampleRate: 48_000 },
};

/** A video with sound: the ordinary case. */
const withBoth = base;
/** An mp3 or a wav: a timeline and a waveform, no frames. */
const audioOnly: ProbeResult = { ...base, video: null, displayName: 'track.mp3' };
/** A screen recording with the microphone off, or an animation export. */
const silentVideo: ProbeResult = { ...base, audio: null };

const io: CommandIo = {
  inputPath: '/work/.tmp/clip.mp4',
  outputPath: '/work/.tmp/out.mp4',
  workDir: '/work/.tmp',
};

const kinds = OPERATIONS.map((op) => op.kind);

describe('what is offered for an ordinary video with sound', () => {
  it('offers every video operation', () => {
    for (const kind of ['trim', 'compress', 'convert', 'resize', 'gif', 'mute'] as const) {
      expect(isAvailable(kind, withBoth), kind).toBe(true);
    }
  });

  it('offers extract audio, which is what separating the track means here', () => {
    expect(isAvailable('extract-audio', withBoth)).toBe(true);
  });

  it('offers loudness, the one audio operation that keeps the picture', () => {
    expect(isAvailable('loudness', withBoth)).toBe(true);
  });

  /**
   * These two are the reason this module exists. On a video they are Trim and
   * Extract audio under different names, and a closed operation list rots the
   * moment there are two routes to one result.
   */
  it('withholds the audio duplicates and names the operation that does the job', () => {
    expect(availabilityOf('audio-trim', withBoth)).toMatchObject({
      state: 'unavailable',
      instead: 'trim',
    });
    expect(availabilityOf('audio-convert', withBoth)).toMatchObject({
      state: 'unavailable',
      instead: 'extract-audio',
    });
  });
});

describe('what is offered for an audio file', () => {
  it('offers the audio operations', () => {
    for (const kind of ['trim', 'audio-trim', 'audio-convert', 'loudness'] as const) {
      expect(isAvailable(kind, audioOnly), kind).toBe(true);
    }
  });

  /**
   * The silent-success cases. ffmpeg ignores `-vf scale` on a file with no
   * video, so resizing an audio file used to report success and hand back an
   * untouched copy, which is the worst way for anything to fail.
   */
  it('withholds every operation that needs a picture', () => {
    for (const kind of ['compress', 'convert', 'resize', 'gif', 'mute', 'replace-audio'] as const) {
      const result = availabilityOf(kind, audioOnly);
      expect(result.state, kind).toBe('unavailable');
      if (result.state === 'unavailable') expect(result.reason, kind).not.toBe('');
    }
  });

  it('points at Convert when asked to extract audio from audio', () => {
    expect(availabilityOf('extract-audio', audioOnly)).toMatchObject({
      state: 'unavailable',
      instead: 'audio-convert',
    });
  });
});

describe('what is offered for a video with no sound', () => {
  it('still offers the video operations', () => {
    for (const kind of ['trim', 'compress', 'convert', 'resize', 'gif'] as const) {
      expect(isAvailable(kind, silentVideo), kind).toBe(true);
    }
  });

  it('withholds every audio operation, and says the track is missing', () => {
    for (const kind of ['extract-audio', 'audio-convert', 'audio-trim', 'loudness'] as const) {
      expect(availabilityOf(kind, silentVideo).state, kind).toBe('unavailable');
    }
  });

  it('withholds mute rather than producing an identical copy', () => {
    expect(availabilityOf('mute', silentVideo)).toMatchObject({ state: 'unavailable' });
  });

  it('still offers replace audio, which is how sound gets added', () => {
    expect(isAvailable('replace-audio', silentVideo)).toBe(true);
  });
});

describe('every operation has an answer for every kind of file', () => {
  it.each(kinds)('%s is decided for all three shapes of file', (kind: OperationKind) => {
    for (const meta of [withBoth, audioOnly, silentVideo]) {
      const result = availabilityOf(kind, meta);
      if (result.state === 'unavailable') {
        // A refusal has to explain itself in the user's terms.
        expect(result.reason.length).toBeGreaterThan(10);
        expect(result.reason.endsWith('.')).toBe(true);
      }
    }
  });

  it('never suggests an operation that is itself unavailable', () => {
    for (const kind of kinds) {
      for (const meta of [withBoth, audioOnly, silentVideo]) {
        const result = availabilityOf(kind, meta);
        if (result.state === 'unavailable' && result.instead !== null) {
          expect(isAvailable(result.instead, meta), `${kind} suggested ${result.instead}`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe('buildArgs refuses what the interface withholds', () => {
  it('will not build a resize for a file with no picture', () => {
    expect(() => buildArgs({ kind: 'resize', width: 640 }, audioOnly, io)).toThrow(
      InvalidOperation,
    );
  });

  it('will not build a GIF from audio', () => {
    expect(() =>
      buildArgs({ kind: 'gif', fps: 12, width: 480, startSec: null, endSec: null }, audioOnly, io),
    ).toThrow(InvalidOperation);
  });

  it('will not build a compress that ffmpeg would silently ignore', () => {
    expect(() => buildArgs({ kind: 'compress', crf: 23, preset: 'medium' }, audioOnly, io)).toThrow(
      InvalidOperation,
    );
  });

  it('still builds what is genuinely available', () => {
    expect(() =>
      buildArgs({ kind: 'audio-trim', startSec: 0, endSec: 5 }, audioOnly, io),
    ).not.toThrow();
    expect(() =>
      buildArgs({ kind: 'loudness', targetI: -16, targetTP: -1.5, targetLRA: 11 }, withBoth, io),
    ).not.toThrow();
  });
});
