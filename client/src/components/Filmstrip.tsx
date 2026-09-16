import { formatTimecode } from '@scrub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { filmstripUrl, waveformUrl } from '@/lib/api';
import { FILMSTRIP_REVEAL_MS } from '@/lib/motion';
import { seekTo, subscribeTime } from '@/lib/playback';
import { cn } from '@/lib/utils';

type FilmstripProps = {
  readonly id: string;
  readonly durationSec: number;
  readonly startSec: number;
  readonly endSec: number;
  readonly onChange: (next: { readonly startSec?: number; readonly endSec?: number }) => void;
  /** Whether the file has sound to draw beneath the frames. */
  readonly hasAudio?: boolean;
  /** No frames to show, so the waveform becomes the whole timeline. */
  readonly audioOnly?: boolean;
};

/**
 * Real frames from the actual file, butted edge to edge under the range.
 *
 * DESIGN.md calls this one of the three things that carry the identity, and the
 * reason is that it cannot look generated: every pixel came out of the user's
 * own video.
 *
 * Trimmed-out regions are the same frames at reduced opacity, not a scrim laid
 * over them - you can still see what you are cutting, which is the entire point
 * of showing frames rather than a bar.
 */
export function Filmstrip({
  id,
  durationSec,
  startSec,
  endSec,
  onChange,
  hasAudio = false,
  audioOnly = false,
}: FilmstripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [waveFailed, setWaveFailed] = useState(false);
  /**
   * The frames sweep in left to right once the tile has decoded.
   *
   * The direction is not arbitrary and it is not decoration: ffmpeg walks the
   * file from the start and tiles the frames in that order, so the wipe uncovers
   * them in the order they were taken. It is one request for one image, not one
   * per frame, so this follows the decode rather than tracking it.
   */
  const [revealed, setRevealed] = useState(false);

  // A new file starts covered again. Without this the second file's frames were
  // already uncovered, and only the first upload ever showed the sweep.
  useEffect(() => {
    setRevealed(false);
    setFailed(false);
    setWaveFailed(false);
  }, [id]);

  const startPercent = (startSec / durationSec) * 100;
  const endPercent = (endSec / durationSec) * 100;

  // The playhead is written straight to the DOM. Routing sixty updates a second
  // through React to move one line would re-render the workspace sixty times.
  useEffect(
    () =>
      subscribeTime((seconds) => {
        const node = playheadRef.current;
        if (node) node.style.left = `${String((seconds / durationSec) * 100)}%`;
      }),
    [durationSec],
  );

  /** Where along the timeline a pointer landed, in seconds. */
  const secondsAt = useCallback(
    (clientX: number): number => {
      const box = trackRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return 0;
      const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      return fraction * durationSec;
    },
    [durationSec],
  );

  const minGap = Math.min(0.1, durationSec / 100);

  /**
   * The wipe itself. The waveform gets it too, because for an audio file the
   * waveform *is* the timeline and showwavespic draws it in the same direction
   * - leaving it out would have meant half the files Scrub opens arriving with
   * no handoff at all.
   */
  const revealStyle = {
    clipPath: `inset(0 ${revealed ? '0%' : '100%'} 0 0)`,
    transition: `clip-path ${String(FILMSTRIP_REVEAL_MS)}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  };

  return (
    <div className="flex flex-col gap-1.5">
      {/* The track does not clip: a handle sits astride the edge it marks, and
          clipping the outer element cut both of them in half at 0% and 100%.
          The frames are clipped by their own wrapper instead. */}
      <div
        ref={trackRef}
        /**
         * Half height below 900px, per DESIGN.md's quality floor. Vertical space
         * is what a short laptop window is short of, and the strip is the one
         * element here that reads perfectly well at half the size - it is a
         * ribbon of frames, not something you inspect.
         */
        className={cn(
          'relative select-none',
          audioOnly || hasAudio ? 'h-12 workspace:h-24' : 'h-8 workspace:h-16',
        )}
        onPointerDown={(event) => {
          // A click on the strip itself scrubs the video. The handles stop
          // propagation, so this never fights with dragging a mark.
          if (event.button !== 0) return;
          seekTo(secondsAt(event.clientX));
        }}
      >
        <div
          className="bg-well border-well-edge absolute inset-0 overflow-hidden rounded-control border"
          style={audioOnly || failed ? undefined : revealStyle}
        >
          {audioOnly ? null : failed ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-micro text-token-transport">No preview frames for this file.</p>
            </div>
          ) : (
            <>
              {/* The frames, dimmed. Everything outside the range stays visible -
                  a scrim would hide exactly what the user is deciding to cut. */}
              <img
                src={filmstripUrl(id)}
                alt=""
                draggable={false}
                ref={(node) => {
                  // A cached tile can finish decoding before React attaches the
                  // handler below, and the sweep would never start.
                  if (node?.complete === true && node.naturalWidth > 0) setRevealed(true);
                }}
                onLoad={() => {
                  setRevealed(true);
                }}
                onError={() => {
                  setFailed(true);
                }}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-30"
              />
              {/* The same frames at full strength, clipped to what is kept.
                  `object-fill` rather than `cover`: position along this strip has
                  to map linearly to time, and cropping would break that. */}
              <img
                src={filmstripUrl(id)}
                alt="Frames from the loaded video"
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
                style={{
                  clipPath: `inset(0 ${String(100 - endPercent)}% 0 ${String(startPercent)}%)`,
                }}
              />
            </>
          )}
        </div>

        {hasAudio && !waveFailed && (
          /**
           * Peak-level cuts are far easier to find by eye than by ear, which is
           * the whole reason for drawing this. It sits under the frames rather
           * than beside them so one horizontal position means one moment in
           * time for both.
           */
          <img
            src={waveformUrl(id)}
            alt=""
            draggable={false}
            ref={(node) => {
              if (audioOnly && node?.complete === true && node.naturalWidth > 0) setRevealed(true);
            }}
            onLoad={() => {
              // Only the audio-only case waits on this one. When there are
              // frames they lead, and the waveform rides the same clip.
              if (audioOnly) setRevealed(true);
            }}
            onError={() => {
              setWaveFailed(true);
            }}
            style={revealStyle}
            className={cn(
              'pointer-events-none absolute inset-x-0 object-fill',
              // Halves with the strip above it, so the ratio between frames and
              // waveform is the same at both sizes.
              audioOnly ? 'inset-y-0 h-full' : 'bottom-0 h-4 opacity-80 workspace:h-8',
            )}
          />
        )}

        {/* Playhead. Positioned by the subscription above, never by React. */}
        <div
          ref={playheadRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow"
          style={{ left: '0%' }}
        />

        <Handle
          label="Start"
          seconds={startSec}
          durationSec={durationSec}
          onSeconds={(value) => {
            onChange({ startSec: Math.min(value, endSec - minGap) });
          }}
          secondsAt={secondsAt}
        />
        <Handle
          label="End"
          seconds={endSec}
          durationSec={durationSec}
          onSeconds={(value) => {
            onChange({ endSec: Math.max(value, startSec + minGap) });
          }}
          secondsAt={secondsAt}
        />
      </div>

      <div className="text-micro text-muted flex justify-between tabular-nums">
        <span>{formatTimecode(0)}</span>
        <span>{formatTimecode(durationSec)}</span>
      </div>
    </div>
  );
}

/**
 * One mark on the timeline.
 *
 * A real button rather than a styled div, so it is focusable and answers arrow
 * keys - landing on an exact frame with a mouse is the task Scrub exists to make
 * less painful, and for some users the keyboard is the only precise way to do it.
 * `setPointerCapture` keeps the drag alive when the pointer leaves the strip.
 */
function Handle({
  label,
  seconds,
  durationSec,
  onSeconds,
  secondsAt,
}: {
  readonly label: string;
  readonly seconds: number;
  readonly durationSec: number;
  readonly onSeconds: (value: number) => void;
  readonly secondsAt: (clientX: number) => number;
}) {
  const [dragging, setDragging] = useState(false);
  const percent = (seconds / durationSec) * 100;

  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-valuenow={seconds}
      aria-valuetext={formatTimecode(seconds)}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        onSeconds(secondsAt(event.clientX));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onKeyDown={(event) => {
        // One frame is too fine to guess at, so a second and a tenth of one are
        // what the arrows move - shift for the coarse step, as everywhere else.
        const step = event.shiftKey ? 1 : 0.1;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onSeconds(seconds - step);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onSeconds(seconds + step);
        } else if (event.key === 'Home') {
          event.preventDefault();
          onSeconds(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onSeconds(durationSec);
        }
      }}
      style={{ left: `${String(percent)}%` }}
      className={cn(
        'absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize touch-none',
        'before:bg-accent before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:content-[""]',
        'after:bg-accent after:absolute after:top-1/2 after:left-1/2 after:h-5 after:w-3 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:content-[""]',
        dragging && 'z-10',
      )}
    />
  );
}
