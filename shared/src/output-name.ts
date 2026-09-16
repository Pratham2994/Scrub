import type { Operation } from './operations.js';

/**
 * What the output file is called, decided once and used by both sides.
 *
 * This lives here for the same reason `buildArgs` does. The command bar used to
 * work the name out for itself and the server worked it out again, and they did
 * not agree: converting to WebM previewed as `clip-convert.mp4` and wrote
 * `clip-convert.webm`. ffmpeg picks its muxer from the extension, so anyone who
 * copied the shown command got VP9 and Opus inside an MP4 - a different file
 * from the one Scrub had just made for them, from a command bar whose entire
 * promise is that it shows what runs.
 *
 * The name also carries the settings that produced it. Two trims of one clip
 * were both `clip-trim.mp4`, which is no help at all in a downloads folder an
 * hour later, and saving the second one meant living with `clip-trim (1).mp4`.
 */

/** Splits on either separator: this runs in the browser, where `path` does not. */
function splitPath(full: string): { dir: string; stem: string; ext: string } {
  const cut = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
  const dir = cut === -1 ? '' : full.slice(0, cut + 1);
  const base = full.slice(cut + 1);
  const dot = base.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension.
  return dot > 0
    ? { dir, stem: base.slice(0, dot), ext: base.slice(dot) }
    : { dir, stem: base, ext: '' };
}

/**
 * The container each operation produces.
 *
 * Not cosmetic: getting it wrong produces a file with the right bytes and the
 * wrong wrapper. Operations that do not change the container keep the source's.
 */
export function outputExtension(op: Operation, sourcePath: string): string {
  switch (op.kind) {
    case 'gif':
      return '.gif';
    case 'convert':
      return `.${op.container}`;
    case 'extract-audio':
    case 'audio-convert':
      // m4a is the container people expect around an AAC track. ".aac" makes
      // ffmpeg write a raw ADTS stream, which many players will not open.
      return op.format === 'aac' ? '.m4a' : `.${op.format}`;
    case 'trim':
    case 'compress':
    case 'resize':
    case 'mute':
    case 'replace-audio':
    case 'audio-trim':
    case 'loudness':
    case 'target-size':
    case 'speed':
    case 'crop':
      return splitPath(sourcePath).ext || '.mp4';
  }
}

/**
 * A moment, short enough to live in a filename: `8s`, `2.5s`, `1m04s`.
 *
 * Tenths survive because they distinguish two trims that a whole second would
 * collapse into the same name, which is the thing this is here to prevent.
 */
function stamp(seconds: number): string {
  const rounded = Math.round(Math.max(0, seconds) * 10) / 10;
  if (rounded < 60) return `${String(rounded)}s`;
  const minutes = Math.floor(rounded / 60);
  const rest = Math.round((rounded - minutes * 60) * 10) / 10;
  return `${String(minutes)}m${rest < 10 ? '0' : ''}${String(rest)}s`;
}

/**
 * What distinguishes this run from the last one, appended to the source stem.
 *
 * Settings left at their default are left out. `clip-compress-crf23.mp4` says
 * what it is; `clip-compress-crf23-medium-yuv420p.mp4` says what it is in a way
 * nobody can read at a glance, and the default was never the interesting part.
 */
export function operationSuffix(op: Operation): string {
  switch (op.kind) {
    case 'trim':
      // Mode changes the frames you get, not just the speed of getting them, so
      // a precise trim and a fast one over the same range are different files.
      return `trim-${stamp(op.startSec)}-${stamp(op.endSec)}${op.mode === 'precise' ? '-precise' : ''}`;
    case 'audio-trim':
      return `trim-${stamp(op.startSec)}-${stamp(op.endSec)}`;
    case 'compress':
      return `compress-crf${String(op.crf)}${op.preset === 'medium' ? '' : `-${op.preset}`}`;
    case 'convert':
      // The extension already names the container; repeating it would give
      // `clip-webm.webm`.
      return 'convert';
    case 'resize':
      return `resize-${String(op.width)}w`;
    case 'target-size':
      // The point of the file is the number, so the number is the name.
      return `fit-${String(op.targetMiB).replace('.', '-')}mb`;
    case 'speed':
      return `speed-${String(op.factor).replace('.', '-')}x`;
    case 'crop':
      return `crop-${String(op.width)}x${String(op.height)}`;
    case 'gif': {
      const window =
        op.startSec === null || op.endSec === null
          ? ''
          : `-${stamp(op.startSec)}-${stamp(op.endSec)}`;
      return `gif-${String(op.fps)}fps-${String(op.width)}w${window}`;
    }
    case 'extract-audio':
      // `clip-audio.mp3`. The extension carries the format.
      return 'audio';
    case 'mute':
      return 'muted';
    case 'replace-audio':
      return 'new-audio';
    case 'audio-convert':
      return op.bitrateKbps === null ? 'convert' : `convert-${String(op.bitrateKbps)}k`;
    case 'loudness':
      // The target is negative and a minus sign in the middle of a filename
      // reads as a separator, so the unit carries the sign instead.
      return `loudness-${String(Math.abs(op.targetI))}lufs`;
  }
}

/**
 * Where ffmpeg writes, in full. The command bar shows this and the server
 * spawns with it, and they are the same string because they are this call.
 *
 * Deterministic, with no unique suffix: running the same operation twice with
 * the same settings means the same file, and overwriting it is what the user
 * means. `-y` is already in the argv. Different settings give a different name,
 * which is the whole point of the suffix above.
 */
export function outputPathFor(sourcePath: string, op: Operation): string {
  const { dir, stem } = splitPath(sourcePath);
  return `${dir}${stem}-${operationSuffix(op)}${outputExtension(op, sourcePath)}`;
}

/**
 * What the file is called when it is saved.
 *
 * Built from the name the user dropped in rather than from the working copy's,
 * so the random suffix Scrub adds on upload never reaches their disk.
 */
export function outputNameFor(displayName: string, op: Operation, sourcePath: string): string {
  const { stem } = splitPath(displayName);
  return `${stem}-${operationSuffix(op)}${outputExtension(op, sourcePath)}`;
}
