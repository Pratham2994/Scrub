import type { ProbeResult } from '@scrub/shared';
import { useEffect, useRef, useState } from 'react';

import { sourceUrl, waveformUrl } from '@/lib/api';
import { registerVideo } from '@/lib/playback';
import { useSaveFrame } from '@/lib/use-save-frame';

/**
 * Codecs a browser will reliably decode. Everything outside this list gets the
 * explanation rather than a black rectangle.
 *
 * HEVC is the one that matters: it is the default for iPhone recordings, and no
 * mainstream browser outside Safari decodes it. The operation still works - only
 * the preview does not - and saying which of the two has failed is the whole
 * point of the message.
 */
const PLAYABLE_VIDEO = new Set(['h264', 'avc1', 'vp8', 'vp9', 'av1', 'theora']);

type MediaWellProps = {
  readonly id: string;
  readonly meta: ProbeResult;
};

export function MediaWell({ id, meta }: MediaWellProps) {
  const [failed, setFailed] = useState(false);
  /** The waveform is drawn by ffmpeg; a file it cannot draw still plays. */
  const [waveFailed, setWaveFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frame = useSaveFrame();

  // A different file deserves a fresh attempt, even if the last one failed.
  useEffect(() => {
    setFailed(false);
    setWaveFailed(false);
  }, [id]);

  /**
   * Tear the media element down by hand when it goes away.
   *
   * Removing a playing <video> from the DOM does not reliably close the HTTP
   * connection behind it - the browser keeps streaming into an element nobody
   * can see. Browsers allow only about six connections per origin, so a few
   * leaked ones and every later request queues behind them, which looks like
   * the whole page has frozen.
   */
  useEffect(
    () => () => {
      const element = videoRef.current;
      registerVideo(null);
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
    [],
  );

  const codec = meta.video?.codec.toLowerCase() ?? null;
  const unplayable = codec !== null && !PLAYABLE_VIDEO.has(codec);
  const audioOnly = meta.video === null;

  if (!audioOnly && (unplayable || failed)) {
    return (
      <Well>
        <div className="max-w-md px-6 text-center">
          <p className="text-label text-token-binary">
            Preview unavailable. This file is {meta.video.codec.toUpperCase()}, which browsers
            can&apos;t decode.
          </p>
          <p className="text-micro text-token-transport mt-1">
            Trimming still works; the timecode fields are exact.
          </p>
        </div>
      </Well>
    );
  }

  if (audioOnly) {
    /**
     * A file with no picture still has a shape, and this is it.
     *
     * DESIGN.md names the waveform as one of the three things carrying the
     * identity and argues its scale at length, and it was only ever drawn on
     * the trim timeline - so every other audio operation showed a stock browser
     * pill on the darkest surface in the app and nothing else. The one thing on
     * screen that comes from the user's own file was missing from the one place
     * they look first.
     *
     * Short rather than tall: the well is sized for a picture, and there is no
     * picture. Enough height to read the envelope, not enough to pretend it is
     * a video.
     */
    return (
      <div className="bg-well border-well-edge flex shrink-0 flex-col justify-center rounded-well border px-6 py-5">
        <div className="mx-auto w-full max-w-xl">
          <p className="text-micro text-token-transport mb-2.5 text-center tabular-nums">
            {describeAudio(meta)}
          </p>
          {!waveFailed && (
            <img
              src={waveformUrl(id)}
              alt=""
              draggable={false}
              onError={() => {
                // ffmpeg could not draw it. The player below still works, and a
                // broken image icon would be worse than no picture at all.
                setWaveFailed(true);
              }}
              className="mb-2.5 h-16 w-full rounded-control object-fill opacity-80"
            />
          )}
          {/* No caption track: this is the user's own file, opened from their own
              disk seconds ago. There is nothing to caption it with. */}
          <audio src={sourceUrl(id)} controls className="w-full" />
        </div>
      </div>
    );
  }

  return (
    <Well saving={frame.saving} onSaveFrame={frame.save}>
      {/* Letterboxed inside the well: `object-contain` so the frame is never
          cropped, and the well keeps its size so the layout does not jump. */}
      <video
        ref={(node) => {
          videoRef.current = node;
          // The filmstrip's playhead and the keyboard shortcuts both drive the
          // element through this, rather than reaching across the component tree.
          registerVideo(node);
        }}
        key={id}
        src={sourceUrl(id)}
        controls
        playsInline
        preload="metadata"
        onPointerUp={(event) => {
          /**
           * Hand keyboard focus back after a click.
           *
           * A focused `<video controls>` answers Space and the arrows from the
           * browser's own shadow DOM, which the page cannot cancel - not even
           * from a capture-phase listener. So clicking the picture silently
           * changed what every shortcut did: Space stopped working and an arrow
           * moved the native seek step instead of one frame.
           *
           * Only pointer focus is dropped. Someone who deliberately Tabs to the
           * video still gets the native controls and their keys.
           */
          event.currentTarget.blur();
        }}
        onError={() => {
          // The allowlist above catches the known cases; this catches the rest,
          // so an exotic codec degrades to the explanation instead of a void.
          setFailed(true);
        }}
        className="h-full max-h-full w-full object-contain"
      />
    </Well>
  );
}

/** "aac, stereo, 48 kHz" rather than a row of raw numbers. */
function describeAudio(meta: ProbeResult): string {
  const audio = meta.audio;
  if (!audio) return 'no audio';
  const channels =
    audio.channels === 1
      ? 'mono'
      : audio.channels === 2
        ? 'stereo'
        : `${String(audio.channels)} channels`;
  const rate =
    audio.sampleRate === null ? null : `${String(Math.round(audio.sampleRate / 100) / 10)} kHz`;
  return [audio.codec, channels, rate].filter((part) => part !== null).join(' · ');
}

function Well({
  children,
  saving = false,
  onSaveFrame,
}: {
  readonly children: React.ReactNode;
  readonly saving?: boolean;
  readonly onSaveFrame?: () => void;
}) {
  return (
    <div className="bg-well border-well-edge relative flex min-h-28 flex-1 items-center justify-center overflow-hidden rounded-well border tall:min-h-32 tall:workspace:min-h-48">
      {onSaveFrame !== undefined && (
        /**
         * Save the frame under the playhead, through the queue like any run.
         * Over the picture rather than beside it, because it belongs to the
         * picture: the moment you want is the one on screen right now.
         */
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-2">
          <button
            type="button"
            disabled={saving}
            onClick={onSaveFrame}
            title="Save the frame under the playhead as a PNG"
            className="text-micro text-token-binary hover:bg-white/10 pointer-events-auto rounded-button px-2 py-1 transition-colors duration-100 disabled:opacity-40"
          >
            {saving ? 'Saving' : 'Save this frame'}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
