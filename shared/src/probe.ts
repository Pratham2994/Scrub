/** Normalised ffprobe output. The server produces this; `buildArgs` consumes it. */

export type ProbeVideoStream = {
  readonly index: number;
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  /** Frames per second as a decimal, from ffprobe's `r_frame_rate` rational. */
  readonly fps: number | null;
  readonly pixelFormat: string | null;
};

export type ProbeAudioStream = {
  readonly index: number;
  readonly codec: string;
  readonly channels: number;
  readonly sampleRate: number | null;
};

export type ProbeResult = {
  /** Absolute path of the probed file. This is the path that reaches `spawn`. */
  readonly path: string;
  /** Name the user recognises. Used for display only, never as an argv token. */
  readonly displayName: string;
  readonly container: string;
  readonly durationSec: number;
  readonly sizeBytes: number;
  readonly bitrate: number | null;
  /** First video stream, or null for audio-only sources. */
  readonly video: ProbeVideoStream | null;
  /** First audio stream, or null for silent sources. */
  readonly audio: ProbeAudioStream | null;
};
