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
 * Rail order. Eleven operations — DESIGN.md's wireframe says ten because it omits
 * "Replace audio", which CLAUDE.md's list includes.
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
