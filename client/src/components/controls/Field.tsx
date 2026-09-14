import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * The control vocabulary every operation panel is built from.
 *
 * One set of primitives rather than each panel styling its own inputs, so the
 * ten operations read as one tool. Every one carries a `hint` slot, because the
 * flags underneath almost all have a cost worth stating — CRF is not a file
 * size, a preset is not quality, and a GIF's width is the main thing that
 * decides whether it is two megabytes or twenty.
 */

export function Row({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex flex-wrap items-start gap-x-6 gap-y-4">{children}</div>;
}

export function Panel({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="border-line bg-surface flex flex-col gap-4 rounded-control border p-4">
      {children}
    </div>
  );
}

export function Hint({ children }: { readonly children: React.ReactNode }) {
  return <p className="text-micro text-muted max-w-prose">{children}</p>;
}

type SelectProps<T extends string> = {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
  readonly hint?: string;
};

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: SelectProps<T>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-label text-muted mb-1 block">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
        className="text-body text-ink border-line-strong bg-surface rounded-control border px-2 py-1.5"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && <p className="text-micro text-muted mt-1 max-w-xs">{hint}</p>}
    </div>
  );
}

type NumberFieldProps = {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly suffix?: string;
  readonly onChange: (value: number) => void;
  readonly hint?: string;
};

/**
 * A number you can type or drag.
 *
 * The slider is for exploring and the field is for landing on a value you
 * already know — offering only one of the two makes the other task tedious.
 * The field commits on blur so a half-typed number is never read as final.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  hint,
}: NumberFieldProps) {
  const id = useId();
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  return (
    <div className="min-w-56">
      <label htmlFor={id} className="text-label text-muted mb-1 block">
        {label}
      </label>
      <div className="flex items-center gap-2">
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
          className="accent-accent min-w-0 flex-1"
        />
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
            'text-body text-ink border-line-strong bg-surface w-20 rounded-control border px-2 py-1',
            'font-mono tabular-nums',
          )}
        />
        {suffix !== undefined && <span className="text-label text-muted shrink-0">{suffix}</span>}
      </div>
      {hint !== undefined && <p className="text-micro text-muted mt-1">{hint}</p>}
    </div>
  );
}

type ChoiceProps<T extends string> = {
  readonly legend: string;
  readonly value: T;
  readonly options: readonly {
    readonly value: T;
    readonly title: string;
    readonly detail: string;
  }[];
  readonly onChange: (value: T) => void;
  readonly name: string;
};

/** Radio cards, for a choice whose options each carry a cost worth reading. */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
  name,
}: ChoiceProps<T>) {
  return (
    <fieldset>
      <legend className="text-label text-muted mb-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex max-w-xs cursor-pointer gap-2 rounded-control border p-3 transition-colors duration-100',
              value === option.value
                ? 'border-accent bg-accent/5'
                : 'border-line hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value);
              }}
              className="accent-accent mt-0.5"
            />
            <span>
              <span className="text-body text-ink block font-medium">{option.title}</span>
              <span className="text-micro text-muted block">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
