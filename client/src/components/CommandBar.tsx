import { Copy, Pencil, Play } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { type CommandToken, tokenizeCommand } from '@/lib/command-tokens';
import { cn } from '@/lib/utils';

const ROLE_CLASS: Record<CommandToken['role'], string> = {
  binary: 'text-token-binary font-medium',
  flag: 'text-token-flag',
  value: 'text-token-value',
  path: 'text-token-path',
  transport: 'text-token-transport',
};

type CommandBarProps = {
  readonly argv: readonly string[];
  /** The empty state shows a real command, dimmed, so the bar is legible from second one. */
  readonly placeholder?: boolean;
};

/**
 * The only loud thing on the screen. Full bleed, radius 0 because it meets the
 * window edges, and the one element carrying a shadow — an upward hairline.
 *
 * A real command does not fit on one line at any window size, so the row scrolls
 * horizontally under a fade instead of truncating or wrapping the bar to an
 * unpredictable height.
 */
export function CommandBar({ argv, placeholder = false }: CommandBarProps) {
  const tokens = tokenizeCommand(argv);
  const firstOperationIndex = tokens.findIndex(
    (token) => token.role !== 'binary' && token.role !== 'transport',
  );

  const scrollRef = useRef<HTMLElement>(null);
  const operationRef = useRef<HTMLSpanElement>(null);
  const [atStart, setAtStart] = useState(true);

  /**
   * Open on the part of the command the user's controls actually move.
   *
   * The transport flags are genuinely in the executed argv and are never hidden —
   * scrolling left reaches them. But they are four tokens of harness plumbing, and
   * leading with them means that at 900px, the narrowest width Scrub supports, the
   * bar is all chrome and no command.
   */
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const operation = operationRef.current;
    if (!scroller || !operation) return;
    scroller.scrollLeft +=
      operation.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    setAtStart(scroller.scrollLeft <= 0);
  }, [argv]);

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller) setAtStart(scroller.scrollLeft <= 0);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return undefined;
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  return (
    <div
      className="bg-well relative flex min-h-commandbar shrink-0 items-center gap-3 px-4"
      style={{ boxShadow: '0 -1px 0 var(--color-line)' }}
    >
      <div className="relative min-w-0 flex-1">
        <code
          ref={scrollRef}
          className={cn(
            'text-mono block overflow-x-auto whitespace-nowrap tabular-nums',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            // Contrast, not taste: at 60% the brightest token still clears 6:1 on
            // --well, which keeps the placeholder readable while reading as inert.
            placeholder && 'opacity-60',
          )}
          aria-label={placeholder ? 'Example command' : 'Command that will run'}
        >
          {tokens.map((token, index) => (
            <span
              key={`${token.full}-${String(index)}`}
              ref={index === firstOperationIndex ? operationRef : undefined}
              className={ROLE_CLASS[token.role]}
              title={token.text === token.full ? undefined : token.full}
            >
              {index > 0 ? ' ' : ''}
              {token.text}
            </span>
          ))}
        </code>
        <div
          aria-hidden
          className={cn(
            'from-well pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r to-transparent transition-opacity duration-100',
            atStart && 'opacity-0',
          )}
        />
        <div
          aria-hidden
          className="from-well pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l to-transparent"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <BarButton label="Copy command" disabled={placeholder}>
          <Copy aria-hidden size={15} />
        </BarButton>
        <BarButton label="Edit command" disabled={placeholder}>
          <Pencil aria-hidden size={15} />
        </BarButton>
      </div>

      <button
        type="button"
        disabled={placeholder}
        className={cn(
          'text-body flex shrink-0 items-center gap-1.5 rounded-button px-4 py-2 font-medium',
          'bg-accent text-white transition-opacity duration-100',
          'disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        Run
        <Play aria-hidden size={13} fill="currentColor" />
      </button>
    </div>
  );
}

function BarButton({
  label,
  disabled,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        'text-token-binary rounded-button p-2 transition-colors duration-100',
        'hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
