import { describe, expect, it } from 'vitest';

import { maxDurationSec, SIZE_PRESETS, sizePreset, videoBitrateKbps } from './size-presets.js';

/**
 * The arithmetic behind "under 10 MB".
 *
 * Every other operation can be a little wrong and still be useful. This one
 * cannot: a file at 10.2 MB against a 10 MB limit is refused after the upload,
 * which is worse than not having offered to do it. So the tests care mostly
 * about the direction of every rounding.
 */

describe('the numbers each platform actually refuses at', () => {
  it('aims under the limit, never at it', () => {
    for (const preset of SIZE_PRESETS) {
      expect(preset.targetMiB, preset.label).toBeLessThan(preset.limitMiB);
    }
  });

  it('explains itself, because a number with no reason is a number nobody trusts', () => {
    for (const preset of SIZE_PRESETS) {
      expect(preset.note.length, preset.label).toBeGreaterThan(40);
    }
  });

  /**
   * Gmail and Outlook both say 25 MB, but that is the *encoded* size and
   * attachments are base64, which adds about a third. Taking the stated number
   * at face value is how a 24 MB file bounces.
   */
  it('reads the email limit as the file size, not the encoded size', () => {
    const email = sizePreset('email');
    expect(email?.limitMiB).toBeLessThan(25);
    expect(email?.limitMiB).toBeGreaterThan(17);
  });

  it('finds a preset by id and returns null for one it does not have', () => {
    expect(sizePreset('discord')?.label).toBe('Discord');
    expect(sizePreset('myspace')).toBeNull();
  });
});

describe('working out the bitrate', () => {
  it('fills the budget without exceeding it', () => {
    // 10 MiB, 60 seconds, 128 kbps of audio.
    const kbps = videoBitrateKbps(10, 60, 128);
    expect(kbps).not.toBeNull();

    const totalKbit = (kbps ?? 0) * 60 + 128 * 60;
    const limitKbit = 10 * 1024 * 8;
    expect(totalKbit).toBeLessThanOrEqual(limitKbit);
    // And not so far under that the picture was starved for no reason.
    expect(totalKbit).toBeGreaterThan(limitKbit * 0.9);
  });

  it('takes the audio out of the budget before the picture gets any', () => {
    const quiet = videoBitrateKbps(10, 60, 64) ?? 0;
    const loud = videoBitrateKbps(10, 60, 256) ?? 0;
    expect(quiet).toBeGreaterThan(loud);
    // Whatever audio gains, video loses, give or take the rounding.
    expect(quiet - loud).toBeGreaterThan(180);
  });

  it('gives a longer file a smaller bitrate, which is the whole shape of it', () => {
    const short = videoBitrateKbps(10, 30, 128) ?? 0;
    const long = videoBitrateKbps(10, 600, 128) ?? 0;
    expect(short).toBeGreaterThan(long * 5);
  });

  /**
   * The honest refusal. Below about 100 kbps h264 stops being a picture, and
   * encoding a smear that happens to be the right size is not a useful answer
   * to "make this fit".
   */
  it('refuses rather than encode a smear', () => {
    // Two hours into 10 MB is not a video.
    expect(videoBitrateKbps(10, 7200, 128)).toBeNull();
    // Nor is a target the audio alone would overflow.
    expect(videoBitrateKbps(0.5, 300, 128)).toBeNull();
  });

  it('refuses a file with no duration rather than dividing by zero', () => {
    expect(videoBitrateKbps(10, 0, 128)).toBeNull();
  });

  it('says how long would have fitted, so the refusal is actionable', () => {
    const longest = maxDurationSec(10, 128);
    expect(longest).toBeGreaterThan(0);
    // The boundary holds: at that length there is a bitrate, well past it there is not.
    expect(videoBitrateKbps(10, longest * 0.9, 128)).not.toBeNull();
    expect(videoBitrateKbps(10, longest * 2, 128)).toBeNull();
  });

  it('never returns a fraction, because ffmpeg takes whole kbit', () => {
    for (const duration of [7, 13.37, 61, 600]) {
      const kbps = videoBitrateKbps(9.5, duration, 128);
      if (kbps !== null) expect(Number.isInteger(kbps), String(duration)).toBe(true);
    }
  });
});
