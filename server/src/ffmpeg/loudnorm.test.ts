import { LOUDNORM_MEASURED, measuredPlaceholder } from '@scrub/shared';
import { describe, expect, it } from 'vitest';

import { applyMeasurement, parseLoudnorm } from './loudnorm.js';

/**
 * The join between loudnorm's two passes.
 *
 * This is the part that was silently wrong once already: both passes ran, but
 * nothing carried between them, so the second normalised blind. A blind
 * loudnorm is a compressor guessing as it goes and it pumps audibly, which is
 * the entire reason the operation has two passes at all.
 */

/** What ffmpeg actually prints, logging and all. */
const REAL_STDERR = `
[Parsed_loudnorm_0 @ 000001d2] Using Fast lookahead
size=N/A time=00:00:25.00 bitrate=N/A speed=52.1x
[Parsed_loudnorm_0 @ 000001d2]
{
	"input_i" : "-46.76",
	"input_tp" : "-42.68",
	"input_lra" : "0.00",
	"input_thresh" : "-56.85",
	"output_i" : "-16.02",
	"output_tp" : "-1.50",
	"output_lra" : "0.00",
	"output_thresh" : "-26.10",
	"normalization_type" : "linear",
	"target_offset" : "0.02"
}
`;

describe('reading the measurement out of ffmpeg’s noise', () => {
  it('finds the JSON block among the logging', () => {
    expect(parseLoudnorm(REAL_STDERR)).toEqual({
      input_i: '-46.76',
      input_tp: '-42.68',
      input_lra: '0.00',
      input_thresh: '-56.85',
      target_offset: '0.02',
    });
  });

  /**
   * With several audio streams ffmpeg prints a block per stream, and the final
   * summary is the one describing what was actually measured.
   */
  it('takes the last block when there are several', () => {
    const two = `${REAL_STDERR}\n{\n"input_i" : "-9.99",\n"input_tp" : "-1.0",\n"input_lra" : "5.0",\n"input_thresh" : "-20.0",\n"target_offset" : "0.0"\n}\n`;
    expect(parseLoudnorm(two)?.input_i).toBe('-9.99');
  });

  it('returns null rather than guessing when there is no block', () => {
    expect(parseLoudnorm('Conversion failed!')).toBeNull();
    expect(parseLoudnorm('')).toBeNull();
  });

  it('returns null for a block that is missing a field it needs', () => {
    expect(parseLoudnorm('{ "input_i" : "-20.0" }')).toBeNull();
  });

  /**
   * Every value stays a string, including `-inf` for a silent file. They are fed
   * back into the filter verbatim; ffmpeg understands its own output better than
   * a round trip through a float would.
   */
  it('keeps the values as strings, so a silent file survives', () => {
    const silent = `{
      "input_i" : "-inf",
      "input_tp" : "-inf",
      "input_lra" : "0.00",
      "input_thresh" : "-inf",
      "target_offset" : "0.00"
    }`;
    expect(parseLoudnorm(silent)?.input_i).toBe('-inf');
  });
});

describe('feeding it into the second pass', () => {
  const measurement = {
    input_i: '-46.76',
    input_tp: '-42.68',
    input_lra: '0.00',
    input_thresh: '-56.85',
    target_offset: '0.02',
  };

  it('substitutes every placeholder', () => {
    const argv = [
      '-af',
      ['loudnorm=I=-16', ...LOUDNORM_MEASURED.map((k) => `${k}=${measuredPlaceholder(k)}`)].join(
        ':',
      ),
      'out.m4a',
    ];

    const applied = applyMeasurement(argv, measurement);

    expect(applied.join(' ')).toContain('measured_I=-46.76');
    expect(applied.join(' ')).toContain('measured_TP=-42.68');
    // Nothing marked may survive into what gets spawned.
    for (const key of LOUDNORM_MEASURED) {
      expect(applied.join(' '), key).not.toContain(measuredPlaceholder(key));
    }
  });

  it('leaves every other argument exactly as it was', () => {
    const argv = ['-i', 'in.mp4', '-c:v', 'copy', '-y', 'out.mp4'];
    expect(applyMeasurement(argv, measurement)).toEqual(argv);
  });

  /**
   * The placeholders are deliberately not valid ffmpeg syntax, so a pass that
   * somehow reached spawn unsubstituted fails loudly instead of quietly
   * normalising against nothing.
   */
  it('uses placeholders ffmpeg would refuse', () => {
    for (const key of LOUDNORM_MEASURED) {
      const placeholder = measuredPlaceholder(key);
      expect(placeholder, key).toMatch(/[^A-Za-z0-9.:=_-]/);
    }
  });
});
