/**
 * The closed operation set. CLAUDE.md keeps this list closed on purpose: anything
 * not here is done by editing the command bar, not by growing a control panel.
 *
 * `kind` doubles as the route slug (`/op/:name`) so there is one spelling of an
 * operation in the whole codebase.
 */

export type TrimMode = 'fast' | 'precise';

export type VideoTrim = {
  readonly kind: 'trim';
  readonly startSec: number;
  readonly endSec: number;
  /**
   * `fast` puts `-ss` before `-i` and stream-copies: no re-encode, but the cut
   * lands on a keyframe. `precise` puts `-ss` after `-i` and re-encodes.
   * The user picks; Scrub never picks for them.
   */
  readonly mode: TrimMode;
};

export type VideoCompress = {
  readonly kind: 'compress';
  /** Constant Rate Factor. Lower is bigger and better; 18–28 is the useful band. */
  readonly crf: number;
  readonly preset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow' | 'veryslow';
};

export type VideoContainer = 'mp4' | 'webm' | 'mkv' | 'mov';

export type VideoConvert = {
  readonly kind: 'convert';
  readonly container: VideoContainer;
};

export type VideoResize = {
  readonly kind: 'resize';
  /** Target width in pixels. Height follows the source aspect ratio via `-2`. */
  readonly width: number;
};

export type VideoGif = {
  readonly kind: 'gif';
  readonly fps: number;
  readonly width: number;
  readonly startSec: number | null;
  readonly endSec: number | null;
};

export type AudioFormat = 'mp3' | 'aac' | 'wav' | 'flac' | 'opus';

export type VideoExtractAudio = {
  readonly kind: 'extract-audio';
  readonly format: AudioFormat;
};

export type VideoMute = {
  readonly kind: 'mute';
};

/**
 * Fit the file under a size, rather than aim at a quality.
 *
 * Compress asks for a CRF and gives you whatever size that quality happens to
 * take, which is the honest answer to "how good" and useless for "it has to be
 * under 10 MB or Discord refuses it". This is the other question, and it needs a
 * genuinely different command: a bitrate worked out from the target divided by
 * the duration, encoded in two passes so the encoder can spend that budget where
 * the picture needs it.
 */
export type VideoTargetSize = {
  readonly kind: 'target-size';
  /** What the whole file must come in under, in mebibytes. */
  readonly targetMiB: number;
  /** Audio is given a fixed slice of the budget; the picture gets the rest. */
  readonly audioKbps: number;
  /** Scale down as well, when the source is far larger than the target needs. */
  readonly maxWidth: number | null;
};

/**
 * Faster or slower, picture and sound together.
 *
 * `setpts` restamps the frames and `atempo` stretches the audio to match. They
 * have to move together or the result drifts out of sync, so this is one control
 * and not two.
 */
export type VideoSpeed = {
  readonly kind: 'speed';
  /** 2 is twice as fast, 0.5 is half. */
  readonly factor: number;
};

/**
 * A rectangle out of the picture.
 *
 * Every value is even. libx264 needs even dimensions and an odd offset lands the
 * chroma plane half a pixel out, which is a colour smear rather than an error.
 */
export type VideoCrop = {
  readonly kind: 'crop';
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
};

export type VideoReplaceAudio = {
  readonly kind: 'replace-audio';
  /** Upload id of the replacement audio track, resolved to a path by the server. */
  readonly audioId: string;
};

export type AudioConvert = {
  readonly kind: 'audio-convert';
  readonly format: AudioFormat;
  readonly bitrateKbps: number | null;
};

export type AudioTrim = {
  readonly kind: 'audio-trim';
  readonly startSec: number;
  readonly endSec: number;
};

export type AudioLoudness = {
  readonly kind: 'loudness';
  /** Integrated loudness target in LUFS. -16 is the streaming-platform default. */
  readonly targetI: number;
  /** True peak ceiling in dBTP. */
  readonly targetTP: number;
  /** Loudness range target in LU. */
  readonly targetLRA: number;
};

export type Operation =
  | VideoTrim
  | VideoCompress
  | VideoConvert
  | VideoResize
  | VideoGif
  | VideoExtractAudio
  | VideoMute
  | VideoTargetSize
  | VideoSpeed
  | VideoCrop
  | VideoReplaceAudio
  | AudioConvert
  | AudioTrim
  | AudioLoudness;

export type OperationKind = Operation['kind'];

export type OperationGroup = 'video' | 'audio';

export type OperationDescriptor = {
  readonly kind: OperationKind;
  /** Rail label. A verb the user already has in their head, sentence case. */
  readonly label: string;
  readonly group: OperationGroup;
  /** One line of `--muted` micro text under the operation title. */
  readonly blurb: string;
};

/**
 * Rail order. Fourteen operations.
 *
 * The list is still closed - it is not a settings panel and it does not grow to
 * cover ffmpeg - but it is closed around what people actually do, and three
 * things were missing from that. "Under 10 MB" is the most common video request
 * there is and compress could not answer it; speed and crop are in the same
 * everyday category as trim and resize.
 */
export const OPERATIONS: readonly OperationDescriptor[] = [
  { kind: 'trim', label: 'Trim', group: 'video', blurb: 'Cut a clip out of a video.' },
  { kind: 'compress', label: 'Compress', group: 'video', blurb: 'Make the file smaller.' },
  { kind: 'convert', label: 'Convert', group: 'video', blurb: 'Change the container and codec.' },
  { kind: 'resize', label: 'Resize', group: 'video', blurb: 'Scale to a target width.' },
  { kind: 'gif', label: 'GIF', group: 'video', blurb: 'Two-pass GIF with a real palette.' },
  {
    kind: 'extract-audio',
    label: 'Extract audio',
    group: 'video',
    blurb: 'Pull the audio track out.',
  },
  { kind: 'mute', label: 'Mute', group: 'video', blurb: 'Drop the audio track.' },
  {
    kind: 'target-size',
    label: 'Fit a size',
    group: 'video',
    blurb: 'Hit a file size, for somewhere that has a limit.',
  },
  { kind: 'speed', label: 'Speed', group: 'video', blurb: 'Faster or slower, sound kept in step.' },
  { kind: 'crop', label: 'Crop', group: 'video', blurb: 'Cut a rectangle out of the picture.' },
  {
    kind: 'replace-audio',
    label: 'Replace audio',
    group: 'video',
    blurb: 'Swap in a different audio track.',
  },
  { kind: 'audio-convert', label: 'Convert', group: 'audio', blurb: 'Change the audio format.' },
  { kind: 'audio-trim', label: 'Trim', group: 'audio', blurb: 'Cut a section out of audio.' },
  {
    kind: 'loudness',
    label: 'Loudness',
    group: 'audio',
    blurb: 'Two-pass loudnorm to a LUFS target.',
  },
];

const OPERATION_KINDS: ReadonlySet<string> = new Set(OPERATIONS.map((op) => op.kind));

export function isOperationKind(value: string): value is OperationKind {
  return OPERATION_KINDS.has(value);
}

export function operationDescriptor(kind: OperationKind): OperationDescriptor {
  const found = OPERATIONS.find((op) => op.kind === kind);
  if (!found) {
    // Unreachable while OPERATIONS covers the union; the throw keeps it that way.
    throw new Error(`operationDescriptor: no descriptor for "${kind}"`);
  }
  return found;
}
