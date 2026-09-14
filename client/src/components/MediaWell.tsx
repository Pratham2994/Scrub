import type { ProbeResult } from '@scrub/shared';
import { useEffect, useRef, useState } from 'react';

import { sourceUrl } from '@/lib/api';
import { registerVideo } from '@/lib/playback';

/**
 * Codecs a browser will reliably decode. Everything outside this list gets the
 * explanation rather than a black rectangle.
 *
 * HEVC is the one that matters: it is the default for iPhone recordings, and no
 * mainstream browser outside Safari decodes it. The operation still works — only
 * the preview does not — and saying which of the two has failed is the whole
 * point of the message.
 */
const PLAYABLE_VIDEO = new Set(['h264', 'avc1', 'vp8', 'vp9', 'av1', 'theora']);

type MediaWellProps = {
  readonly id: string;
  readonly meta: ProbeResult;
};

export function MediaWell({ id, meta }: MediaWellProps) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // A different file deserves a fresh attempt, even if the last one failed.
  useEffect(() => {
    setFailed(false);
  }, [id]);

  /**
   * Tear the media element down by hand when it goes away.
   *
   * Removing a playing <video> from the DOM does not reliably close the HTTP
   * connection behind it — the browser keeps streaming into an element nobody
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
            Preview unavailable — this file is {meta.video.codec.toUpperCase()}, which browsers
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
    return (
      <Well>
        <div className="w-full max-w-xl px-6">
          <p className="text-micro text-token-transport mb-3 text-center tabular-nums">
            {meta.audio?.codec ?? 'audio'} · {meta.audio?.channels ?? 0} ch ·{' '}
            {meta.audio?.sampleRate ?? 0} Hz
          </p>
          {/* No caption track: this is the user's own file, opened from their own
              disk seconds ago. There is nothing to caption it with. */}
          <audio src={sourceUrl(id)} controls className="w-full" />
        </div>
      </Well>
    );
  }

  return (
    <Well>
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
           * browser's own shadow DOM, which the page cannot cancel — not even
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

function Well({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="bg-well border-well-edge flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-well border">
      {children}
    </div>
  );
}
