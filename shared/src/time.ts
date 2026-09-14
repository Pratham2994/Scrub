/**
 * Seconds formatted for an ffmpeg time argument.
 *
 * ffmpeg accepts both `HH:MM:SS.mmm` and a bare seconds value. Scrub emits bare
 * seconds because the command bar is meant to be read and re-typed, and
 * `-ss 12.4` is legible where `-ss 00:00:12.400` is noise.
 *
 * Rounded to milliseconds: ffmpeg's own timebase resolution for these arguments
 * is finer, but no source of ours (a scrub handle, a typed timecode) is more
 * precise than a millisecond, and trailing float noise like `12.400000000000002`
 * would otherwise leak into a command the user is about to copy.
 */
export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`formatSeconds: expected a finite number, received ${String(seconds)}`);
  }
  const clamped = Math.max(0, seconds);
  const rounded = Math.round(clamped * 1000) / 1000;
  // `toFixed(3)` then strip trailing zeros: 12 -> "12", 12.4 -> "12.4", 12.004 -> "12.004".
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

/** `HH:MM:SS.mm` for timecode readouts. Display only — never an ffmpeg argument. */
export function formatTimecode(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const centis = Math.floor((clamped % 1) * 100);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(centis)}`;
}
