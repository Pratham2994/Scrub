import { LOUDNORM_MEASURED, measuredPlaceholder } from '@scrub/shared';
import { z } from 'zod';

/**
 * What `loudnorm`'s first pass prints, on stderr, as JSON.
 *
 * Every value is a string — including `"-inf"` when a file is silent, which is
 * why these are not parsed as numbers here. They are substituted back into the
 * filter verbatim, and ffmpeg understands its own output better than a round
 * trip through a float would.
 */
const measurementSchema = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  target_offset: z.string(),
});

export type LoudnormMeasurement = z.infer<typeof measurementSchema>;

/**
 * Finds the JSON block in pass one's stderr.
 *
 * It is surrounded by ffmpeg's ordinary logging, so this takes the last balanced
 * `{...}` rather than trying to parse the whole stream. The last one matters:
 * with several audio streams ffmpeg prints a block per stream, and the final
 * summary is the one describing what was actually measured.
 */
export function parseLoudnorm(stderr: string): LoudnormMeasurement | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed: unknown = JSON.parse(stderr.slice(start, end + 1));
    const result = measurementSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** ffmpeg's own names for the values, mapped to the ones the filter expects. */
const FILTER_KEYS: Record<(typeof LOUDNORM_MEASURED)[number], keyof LoudnormMeasurement> = {
  measured_I: 'input_i',
  measured_TP: 'input_tp',
  measured_LRA: 'input_lra',
  measured_thresh: 'input_thresh',
  offset: 'target_offset',
};

/**
 * Puts the measurements into the pass that needs them.
 *
 * The placeholders are deliberately not valid ffmpeg syntax, so a pass that
 * somehow reached `spawn` without being substituted fails immediately and
 * loudly rather than silently normalising against nothing.
 */
export function applyMeasurement(
  argv: readonly string[],
  measurement: LoudnormMeasurement,
): readonly string[] {
  return argv.map((token) => {
    let next = token;
    for (const key of LOUDNORM_MEASURED) {
      next = next.split(measuredPlaceholder(key)).join(measurement[FILTER_KEYS[key]]);
    }
    return next;
  });
}
