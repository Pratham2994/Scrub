import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useScrubStore } from '@/store/use-scrub-store';

export type InputsItem = {
  readonly id: string;
  readonly name: string;
};

type InputsCardProps = {
  /** What the list is, e.g. "Clips to join, in order". */
  readonly legend: string;
  /** What the drop zone says before anything is added. */
  readonly empty: string;
  /** The picker's accept list: "video/*", "audio/*", or "image/*". */
  readonly accept: string;
  readonly items: readonly InputsItem[];
  readonly max: number;
  readonly loading: string | null;
  readonly error: string | null;
  readonly onAdd: (file: File | undefined | null) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
};

/**
 * The extra inputs for the multi-input operations.
 *
 * The loaded file is always row 0 and is not part of this list; the card is
 * everything after it. Order matters for merge, which is the only reason the
 * arrows exist.
 */
export function InputsCard({
  legend,
  empty,
  accept,
  items,
  max,
  loading,
  error,
  onAdd,
  onRemove,
  onMove,
}: InputsCardProps) {
  const meta = useScrubStore((state) => state.meta);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = items.length >= max;

  return (
    <div>
      <p className="text-micro text-muted mb-2 tracking-wide">{legend}</p>
      <ol className="border-line overflow-hidden rounded-control border">
        {meta !== null && (
          <li className="border-line text-label text-ink flex items-center gap-2 border-b bg-surface/60 px-3 py-2 font-mono">
            <span className="text-micro text-muted w-4 shrink-0 text-right tabular-nums">1</span>
            <span className="truncate">{meta.displayName}</span>
            <span className="text-micro text-muted ml-auto shrink-0">loaded</span>
          </li>
        )}
        {items.map((item, index) => (
          <li
            key={item.id}
            className="border-line text-label text-ink flex items-center gap-2 border-b px-3 py-2 font-mono last:border-b-0"
          >
            <span className="text-micro text-muted w-4 shrink-0 text-right tabular-nums">
              {String(index + 2)}
            </span>
            <span className="truncate">{item.name}</span>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={`Move ${item.name} up`}
                disabled={index === 0}
                onClick={() => {
                  onMove(item.id, -1);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100 disabled:opacity-30"
              >
                <ArrowUp aria-hidden size={13} />
              </button>
              <button
                type="button"
                aria-label={`Move ${item.name} down`}
                disabled={index === items.length - 1}
                onClick={() => {
                  onMove(item.id, 1);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100 disabled:opacity-30"
              >
                <ArrowDown aria-hidden size={13} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => {
                  onRemove(item.id);
                }}
                className="text-muted hover:text-ink rounded-button p-1 transition-colors duration-100"
              >
                <X aria-hidden size={13} />
              </button>
            </div>
          </li>
        ))}
      </ol>

      {!full && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => {
            setOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOver(false);
            onAdd(event.dataTransfer.files[0]);
          }}
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed px-6 py-3 text-center transition-colors duration-100',
            over ? 'border-accent bg-accent/[0.06]' : 'border-line-strong',
          )}
        >
          <p className="text-label text-muted">
            {loading !== null ? `Loading ${loading}` : items.length === 0 ? empty : 'Add another'}
          </p>
        </div>
      )}
      {error !== null && <p className="text-micro text-accent mt-1">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onAdd(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
