import type { ProbeResult } from '@scrub/shared';
import { useEffect, useState } from 'react';

import { sourceUrl } from '@/lib/api';

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

  // A different file deserves a fresh attempt, even if the last one failed.
  useEffect(() => {
    setFailed(false);
  }, [id]);

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
        key={id}
        src={sourceUrl(id)}
        controls
        playsInline
        preload="metadata"
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
    <div className="bg-well flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-well">
      {children}
    </div>
  );
}
