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

    /**
     * All three are picture operations. On an audio file the filters would be
     * ignored and ffmpeg would report success over an untouched copy, which is
     * the silent-wrong-answer case this module exists to prevent.
     */
    case 'target-size':
      return hasVideo
        ? AVAILABLE
        : no(
            'Fitting a size works by trading picture quality for bytes, and this file has no picture. Convert it to a smaller audio format instead.',
            'audio-convert',
          );

    case 'speed':
      return hasVideo
        ? AVAILABLE
        : no('This file has no picture, and Scrub does not change audio speed on its own.', null);

    case 'crop':
      return hasVideo ? AVAILABLE : no('There is no picture here to crop.', null);

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

    // Merging joins pictures; the audio version is its own operation.
    case 'merge':
      return hasVideo
        ? AVAILABLE
        : no(
            'This file has no picture, and joining songs is a different operation.',
            'merge-audio',
          );

    case 'merge-audio':
      if (!hasAudio) return no('This file has no sound to join.', null);
      return hasVideo
        ? no('This would drop the picture, which is what Merge is for.', 'merge')
        : AVAILABLE;

    case 'add-music':
      return hasVideo
        ? AVAILABLE
        : no(
            'There is no picture here to put music under. Extract the audio and merge songs instead.',
            null,
          );

    case 'watermark':
      return hasVideo ? AVAILABLE : no('There is no picture here to stamp.', null);

    // Fade is the whole clip: picture and sound together. Sound-only fading is
    // Audio fade, which also works on a video with the picture copied across.
    case 'fade':
      return hasVideo
        ? AVAILABLE
        : no('This file has nothing to fade but sound, which is Audio fade.', 'audio-fade');

    case 'audio-fade':
      return hasAudio ? AVAILABLE : no('This file has no sound to fade.', null);

    // Looping loops the whole file. Two routes to one result would rot the list.
    case 'loop':
      return hasVideo
        ? AVAILABLE
        : no('This file is audio only, so Audio loop is the operation you want.', 'audio-loop');

    case 'audio-loop':
      return !hasVideo && hasAudio
        ? AVAILABLE
        : no('This loops the whole file, picture and sound, which is Loop.', 'loop');

    case 'volume':
      return hasVideo
        ? AVAILABLE
        : no('This file is audio only, so Audio volume is the operation you want.', 'audio-volume');

    case 'audio-volume':
      if (!hasAudio) return no('This file has no sound to change.', null);
      return hasVideo
        ? no("Changing this file's volume keeps the picture, which is Volume.", 'volume')
        : AVAILABLE;
  }
}

export function isAvailable(kind: OperationKind, meta: ProbeResult): boolean {
  return availabilityOf(kind, meta).state === 'available';
}
