import { ArrowRight } from 'lucide-react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * The control vocabulary every operation panel is built from.
 *
 * The organising idea is that Scrub is an instrument, not a form. A form asks
 * for values and explains them in grey prose; an instrument shows what the
 * setting does to the thing in front of you. So every panel pairs its controls
 * with a readout derived from the loaded file, in tabular figures, and each
 * choice carries the consequence of picking it rather than a generic label.
 *
 * docs/DESIGN.md's test governs what is allowed here: does it come from the file, or
 * is it decoration? Numbers in these readouts are computed from what ffprobe
 * actually found. Where a value genuinely cannot be known before the encode
 * runs, it says so instead of inventing one.
 */

export function Panel({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="border-line bg-surface flex flex-col gap-5 rounded-control border p-4">
      {children}
    </div>
  );
}

export function Row({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-5">{children}</div>;
}

/** A quiet section label. Sentence case, per docs/DESIGN.md: no all-caps anywhere. */
export function Legend({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-micro text-muted mb-2 tracking-wide">{children}</p>;
}

export function Note({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-micro text-muted max-w-prose leading-relaxed">{children}</p>;
}

export type ReadoutLine = {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** Set when the value cannot be known until the encode has run. */
  readonly estimated?: boolean;
};

/**
 * Source on the left, result on the right, in tabular figures.
 *
 * This is the piece that makes a panel feel like an instrument: it answers
 * "what will this do to my file" with numbers taken from the file, before
 * anything runs. Values that genuinely cannot be known in advance are marked,
 * because a confident wrong number is worse than an honest approximate one.
 */
export function Readout({ lines }: { readonly lines: readonly ReadoutLine[] }) {
  return (
    <dl className="border-line divide-line bg-paper/40 divide-y rounded-control border">
      {lines.map((line) => (
        <div
          key={line.label}
          className="grid grid-cols-[7.5rem_1fr] items-baseline gap-x-4 px-3 py-2.5"
        >
          <dt className="text-label text-muted">{line.label}</dt>
          <dd className="flex min-w-0 items-baseline gap-3">
            {line.from !== '' && (
              <>
                <span className="text-body text-muted truncate font-mono tabular-nums">
                  {line.from}
                </span>
                <ArrowRight
                  aria-hidden
                  size={13}
                  className="text-line-strong shrink-0 translate-y-0.5"
                />
              </>
            )}
            <span className="text-body text-ink truncate font-mono tabular-nums">
              {line.estimated === true && <span className="text-muted">≈ </span>}
              {line.to}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Tick = { readonly at: number; readonly label: string };

type NumberFieldProps = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix?: string;
  readonly onChange: (value: number) => void;
  /** Named positions on the scale, so the number means something at a glance. */
  readonly ticks?: readonly Tick[] | undefined;
  /** What the current value means, in a few words. */
  readonly meaning?: string | undefined;
};

/**
 * A number you can drag or type, with the scale annotated.
 *
 * The ticks are the point. "CRF 23" means nothing to someone who has not used
 * x264; "23, the default, between near-lossless at 18 and visibly soft at 28"
 * means something immediately. Labelling the scale is what turns an ffmpeg flag
 * into a decision a person can make.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  ticks,
  meaning,
}: NumberFieldProps) {
  const id = useId();
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="min-w-64 flex-1">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-label text-muted">
          {label}
        </label>
        <span className="flex items-baseline gap-1">
          {/*
            The value is typeable, not just draggable. A slider is for exploring
            and a field is for landing on a number you already know, and removing
            one of the two makes that task tedious. It is styled as the readout it
            is, and only shows its edges when focused or hovered.
          */}
          <input
            type="number"
            aria-label={`${label} value`}
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number.parseFloat(event.target.value);
              if (Number.isFinite(next)) onChange(next);
            }}
            onBlur={(event) => {
              const next = Number.parseFloat(event.target.value);
              onChange(Number.isFinite(next) ? clamp(next) : value);
            }}
            className={cn(
              'text-heading text-ink w-[4.5ch] rounded-button border border-transparent bg-transparent',
              'text-right font-mono tabular-nums',
              'hover:border-line focus-visible:border-accent focus-visible:outline-none',
              '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none',
            )}
          />
          {suffix !== undefined && <span className="text-label text-muted">{suffix}</span>}
        </span>
      </div>

      <div className="relative">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            onChange(clamp(Number.parseFloat(event.target.value)));
          }}
          className="accent-accent w-full"
        />
        {ticks !== undefined && (
          <div aria-hidden className="relative mt-1 h-4">
            {ticks.map((tick) => {
              const at = ((tick.at - min) / (max - min)) * 100;
              const near = Math.abs(at - percent) < 6;
              return (
                <span
                  key={tick.label}
                  style={{ left: `${String(at)}%` }}
                  className={cn(
                    'text-micro absolute -translate-x-1/2 whitespace-nowrap transition-colors duration-100',
                    near ? 'text-ink' : 'text-muted',
                  )}
                >
                  {tick.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {meaning !== undefined && (
        <p className={cn('text-micro text-muted', ticks === undefined ? 'mt-1.5' : 'mt-4')}>
          {meaning}
        </p>
      )}
    </div>
  );
}

type Option<T extends string> = {
  readonly value: T;
  readonly label: string;
  /** What choosing this actually does. Never a restatement of the label. */
  readonly detail: string;
};

/**
 * A choice laid out as cards, each carrying its own consequence.
 *
 * A dropdown of format names tells someone who already knows the formats what
 * they already knew, and tells everyone else nothing. Spending the space to say
 * what each one costs is the difference between a menu and a decision.
 */
export function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  readonly legend: string;
  readonly name: string;
  readonly value: T;
  readonly options: readonly Option<T>[];
  readonly onChange: (value: T) => void;
  readonly columns?: 2 | 3;
}) {
  return (
    <fieldset>
      <Legend>{legend}</Legend>
      <div
        className={cn(
          'grid gap-2',
          columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                'group relative flex cursor-pointer flex-col gap-0.5 rounded-control border p-3',
                'transition-colors duration-100',
                active
                  ? 'border-accent bg-accent/[0.06]'
                  : 'border-line hover:border-line-strong hover:bg-paper/60',
              )}
            >
              <input
                type="radio"
                name={name}
                checked={active}
                onChange={() => {
                  onChange(option.value);
                }}
                className="sr-only"
              />
              {/* The mark doubles as the focus target, so keyboard users see the
                  same selection cue as everyone else. */}
              <span
                aria-hidden
                className={cn(
                  'absolute top-3 right-3 h-2 w-2 rounded-full transition-colors duration-100',
                  active ? 'bg-accent' : 'bg-line group-hover:bg-line-strong',
                )}
              />
              <span className="text-body text-ink pr-5 font-medium">{option.label}</span>
              <span className="text-micro text-muted leading-relaxed">{option.detail}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
