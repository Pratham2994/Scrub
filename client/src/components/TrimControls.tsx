import { formatTimecode, type ProbeResult } from '@scrub/shared';
import { useEffect, useRef } from 'react';

import { Filmstrip } from '@/components/Filmstrip';
import { cn } from '@/lib/utils';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * Start and end, and the fast/precise choice.
 *
 * Two range inputs stacked over one track make the handles: it is not the
 * filmstrip scrubber yet, but it is a real two-handed range over the real
 * duration, and it is keyboard-operable for free — which matters, because
 * landing on an exact frame with a mouse is the thing Scrub exists to make less
 * painful.
 */
export function TrimControls({
  id,
  meta,
  audioOnly = false,
}: {
  readonly id: string;
  readonly meta: ProbeResult;
  /** Audio trim has no keyframe problem, so it has no fast/precise decision. */
  readonly audioOnly?: boolean;
}) {
  const trim = useScrubStore((state) => state.trim);
  const setTrim = useScrubStore((state) => state.setTrim);

  const duration = meta.durationSec;
  // Audio files have no frames, but the waveform gives them a real timeline.
  const hasFrames = meta.video !== null && !audioOnly;
  // A hair of separation, so the handles can never cross into an empty clip.
  const minGap = Math.min(0.1, duration / 100);

  return (
    <div className="border-line bg-surface flex flex-col gap-4 rounded-control border p-4">
      <Filmstrip
        id={id}
        durationSec={duration}
        startSec={trim.startSec}
        endSec={trim.endSec}
        onChange={setTrim}
        hasAudio={meta.audio !== null}
        audioOnly={!hasFrames}
      />

      <div className="flex flex-wrap items-end gap-6">
        <TimecodeField
          label="Start"
          seconds={trim.startSec}
          max={duration}
          onCommit={(value) => {
            setTrim({ startSec: Math.min(Math.max(0, value), trim.endSec - minGap) });
          }}
        />
        <TimecodeField
          label="End"
          seconds={trim.endSec}
          max={duration}
          onCommit={(value) => {
            setTrim({ endSec: Math.max(Math.min(duration, value), trim.startSec + minGap) });
          }}
        />
        <div>
          <p className="text-label text-muted mb-1">Length</p>
          <p className="text-body text-ink font-mono tabular-nums">
            {formatTimecode(trim.endSec - trim.startSec)}
          </p>
        </div>
      </div>

      {!audioOnly && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label text-muted mb-1">Accuracy</legend>
          <div className="flex flex-wrap gap-2">
            <ModeOption
              checked={trim.mode === 'fast'}
              onSelect={() => {
                setTrim({ mode: 'fast' });
              }}
              title="Fast"
              detail="No re-encode, near-instant. Cuts on the nearest keyframe, so the clip can start earlier and run longer than asked."
            />
            <ModeOption
              checked={trim.mode === 'precise'}
              onSelect={() => {
                setTrim({ mode: 'precise' });
              }}
              title="Precise"
              detail="Exactly these timecodes. Re-encodes the video, so it takes longer and loses a little quality."
            />
          </div>
        </fieldset>
      )}
    </div>
  );
}

/**
 * A timecode you can type into. Held as text while focused so a half-typed value
 * is not fought over by the store, and committed on blur or Enter.
 */
function TimecodeField({
  label,
  seconds,
  max,
  onCommit,
}: {
  readonly label: string;
  readonly seconds: number;
  readonly max: number;
  readonly onCommit: (seconds: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  /**
   * Follow the store, but never while the field has focus.
   *
   * This used to be `key={seconds}`, which tore the input out of the DOM and
   * rebuilt it on every store update — once per pointer move while a handle was
   * being dragged, and mid-word if the value changed while someone was typing.
   */
  useEffect(() => {
    const element = ref.current;
    if (!element || document.activeElement === element) return;
    element.value = formatTimecode(seconds);
  }, [seconds]);

  return (
    <label className="block">
      <span className="text-label text-muted mb-1 block">{label}</span>
      <input
        ref={ref}
        defaultValue={formatTimecode(seconds)}
        inputMode="decimal"
        aria-label={`${label} timecode`}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const parsed = parseTimecode(event.target.value);
          // An unparseable entry snaps back rather than silently becoming zero.
          if (parsed === null || parsed > max) event.target.value = formatTimecode(seconds);
          else onCommit(parsed);
        }}
        className="text-body text-ink border-line-strong bg-surface w-36 rounded-control border px-2 py-1.5 font-mono tabular-nums"
      />
    </label>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  detail,
}: {
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <label
      className={cn(
        'flex max-w-xs cursor-pointer gap-2 rounded-control border p-3 transition-colors duration-100',
        checked ? 'border-accent bg-accent/5' : 'border-line hover:border-line-strong',
      )}
    >
      <input
        type="radio"
        name="trim-mode"
        checked={checked}
        onChange={onSelect}
        className="accent-accent mt-0.5"
      />
      <span>
        <span className="text-body text-ink block font-medium">{title}</span>
        <span className="text-micro text-muted block">{detail}</span>
      </span>
    </label>
  );
}

/** Accepts `HH:MM:SS.mm`, `MM:SS`, or plain seconds — whatever the user types. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  let total = 0;
  for (const part of parts) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value) || value < 0) return null;
    total = total * 60 + value;
  }
  return total;
}
