import { describe, expect, it } from 'vitest';

import { estimateRemainingMs } from './jobs.js';

/**
 * Time remaining, which is the only number on the progress bar that is a claim
 * about the future. Elapsed answers "has it hung"; this answers "do I wait",
 * and it is worth getting right because a figure that jumps around teaches
 * people to ignore the next one too.
 */

describe('how much longer', () => {
  it('halves as the pass gets halfway, at a steady speed', () => {
    // 60s of output at 1x: a minute of work.
    expect(estimateRemainingMs(60, 0.5, 1, 1)).toBe(30_000);
    expect(estimateRemainingMs(60, 0.75, 1, 1)).toBe(15_000);
  });

  it('accounts for speed, which is the whole point of using ffmpeg’s own', () => {
    // Twice real time means half the wall clock.
    expect(estimateRemainingMs(60, 0.5, 2, 1)).toBe(15_000);
    // Half real time means twice.
    expect(estimateRemainingMs(60, 0.5, 0.5, 1)).toBe(60_000);
  });

  it('counts the passes that have not started', () => {
    const one = estimateRemainingMs(60, 0.5, 1, 1) ?? 0;
    const two = estimateRemainingMs(60, 0.5, 1, 2) ?? 0;
    // A whole second pass on top of what is left of this one.
    expect(two - one).toBe(60_000);
  });

  /**
   * ffmpeg's `speed` is a cumulative average, so its first readings carry the
   * cost of starting the process and are wildly pessimistic. Measured at 3%
   * into a 60s encode it said 3m 42s for something that finished in 20s.
   */
  it('says nothing until a tenth of the pass is done', () => {
    expect(estimateRemainingMs(60, 0.01, 1, 1)).toBeNull();
    expect(estimateRemainingMs(60, 0.09, 1, 1)).toBeNull();
    expect(estimateRemainingMs(60, 0.1, 1, 1)).not.toBeNull();
  });

  it('says nothing when there is nothing to work from', () => {
    // Before ffmpeg reports a speed.
    expect(estimateRemainingMs(60, 0.5, null, 1)).toBeNull();
    // A pass with no measurable output, such as GIF's palette pass.
    expect(estimateRemainingMs(null, 0.5, 1, 1)).toBeNull();
    expect(estimateRemainingMs(0, 0.5, 1, 1)).toBeNull();
    // A speed of zero would divide by nothing.
    expect(estimateRemainingMs(60, 0.5, 0, 1)).toBeNull();
  });

  it('reaches zero at the end rather than going negative', () => {
    expect(estimateRemainingMs(60, 1, 1, 1)).toBe(0);
  });

  it('returns whole milliseconds', () => {
    const value = estimateRemainingMs(97.3, 0.37, 1.23, 2) ?? 0;
    expect(Number.isInteger(value)).toBe(true);
  });
});
