import type { OperationKind } from './operations.js';
import type { ProbeResult } from './probe.js';

/**
 * Whether an operation makes sense for the file that is loaded.
 *
 * Until this existed, picking a video operation on an audio file did one of
 * three things, and all three were bad. Compress and resize reported success
 * while producing nonsense, because ffmpeg quietly ignores `-vf scale` on a
 * file with no video. GIF and mute failed with a bare exit code. And audio trim
 * on a video produced an mp4, which is not what anyone choosing an operation
 * filed under Audio expects.
 *
 * The rule is that Scrub should refuse in the interface, before the command is
 * built, and say which operation the user actually wants instead. A tool whose
 * whole promise is showing you the command must not show you one that cannot
 * work.
 */
export type Availability =
  | { readonly state: 'available' }
  | {
      readonly state: 'unavailable';
      /** Why, in the user's terms. Not an ffmpeg error. */
      readonly reason: string;
      /** The operation that does what they probably meant, when there is one. */
      readonly instead: OperationKind | null;
    };

const AVAILABLE: Availability = { state: 'available' };

function no(reason: string, instead: OperationKind | null = null): Availability {
  return { state: 'unavailable', reason, instead };
}

export function availabilityOf(kind: OperationKind, meta: ProbeResult): Availability {
  const hasVideo = meta.video !== null;
  const hasAudio = meta.audio !== null;

  switch (kind) {
    // Trimming is about the timeline, and every file has one.
    case 'trim':
      return AVAILABLE;

    case 'compress':
    case 'convert':
    case 'resize':
      return hasVideo
        ? AVAILABLE
        : no('This file has no video, so there is no picture to work on.', 'audio-convert');

    case 'gif':
      return hasVideo ? AVAILABLE : no('A GIF is made of frames, and this file has none.', null);

    case 'mute':
      if (!hasVideo) return no('This file is audio only, so muting it would leave nothing.', null);
      return hasAudio ? AVAILABLE : no('This file is already silent.', null);

    case 'replace-audio':
      return hasVideo ? AVAILABLE : no('There is no picture here to put new sound against.', null);

    case 'extract-audio':
      if (!hasAudio) return no('This file has no audio track to pull out.', null);
      // Pulling audio out of a file that is already audio is just a conversion.
      return hasVideo
        ? AVAILABLE
        : no('This file is already audio, so there is nothing to separate.', 'audio-convert');

    case 'audio-convert':
      if (!hasAudio) return no('This file has no audio track.', null);
      // On a video this is Extract audio wearing a different name, and having
      // two routes to one result is how a closed operation list starts to rot.
      return hasVideo
        ? no('This would drop the picture, which is what Extract audio is for.', 'extract-audio')
        : AVAILABLE;

    case 'audio-trim':
      if (!hasAudio) return no('This file has no audio track.', null);
      // Trimming a video's audio means trimming the video: same cut, same file.
      return hasVideo ? no('Trimming this file cuts the picture too.', 'trim') : AVAILABLE;

    // Loudness is the one audio operation that is genuinely useful on a video:
    // it corrects the sound and copies the picture across untouched.
    case 'loudness':
      return hasAudio ? AVAILABLE : no('This file has no audio to measure.', null);
  }
}

export function isAvailable(kind: OperationKind, meta: ProbeResult): boolean {
  return availabilityOf(kind, meta).state === 'available';
}
