import { Check, Copy, Download, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { commandToString, type CommandToken, tokenizeCommand } from '@/lib/command-tokens';
import { downloadUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { RunState } from '@/store/use-scrub-store';

const ROLE_CLASS: Record<CommandToken['role'], string> = {
  binary: 'text-token-binary font-medium',
  flag: 'text-token-flag',
  value: 'text-token-value',
  path: 'text-token-path',
  transport: 'text-token-transport',
};

type CommandBarProps = {
  readonly argv: readonly string[];
  readonly placeholder?: boolean;
  readonly run: RunState;
  readonly canRun: boolean;
  readonly onRun: () => void;
  readonly onCancel: () => void;
};

/**
 * The only loud thing on the screen. Full bleed, radius 0 because it meets the
 * window edges, and the one element carrying a shadow — an upward hairline.
 *
 * A real command does not fit on one line at any window size, so the row scrolls
 * horizontally under fades. It scrolls when the user scrolls it and at no other
 * time: moving someone's viewport for them, especially onto a command they were
 * already reading from the start, is disorienting.
 */
export function CommandBar({
  argv,
  placeholder = false,
  run,
  canRun,
  onRun,
  onCancel,
}: CommandBarProps) {
  const tokens = tokenizeCommand(argv);
  const scrollRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  // Re-measure when the command changes or the window resizes: whether a fade
  // belongs there is a fact about the content, not about scrolling.
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [measure, argv]);

  return (
    <div
      className="bg-well relative flex min-h-commandbar shrink-0 items-center gap-3 px-4"
      style={{ boxShadow: '0 -1px 0 var(--color-line)' }}
    >
      <div className="relative min-w-0 flex-1">
        <code
          ref={scrollRef}
          onScroll={measure}
          tabIndex={0}
          className={cn(
            'text-mono block overflow-x-auto whitespace-nowrap tabular-nums',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            placeholder && 'opacity-60',
          )}
          aria-label={placeholder ? 'Example command' : 'Command that will run'}
        >
          {tokens.map((token, index) => (
            <span
              key={`${token.full}-${String(index)}`}
              className={ROLE_CLASS[token.role]}
              title={token.text === token.full ? undefined : token.full}
            >
              {index > 0 ? ' ' : ''}
              {token.text}
            </span>
          ))}
        </code>
        <Fade side="left" visible={edges.left} />
        <Fade side="right" visible={edges.right} />
      </div>

      <CopyButton argv={argv} disabled={placeholder} />
      <RunControl run={run} canRun={canRun && !placeholder} onRun={onRun} onCancel={onCancel} />
    </div>
  );
}

function Fade({ side, visible }: { readonly side: 'left' | 'right'; readonly visible: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'from-well pointer-events-none absolute inset-y-0 w-10 to-transparent transition-opacity duration-100',
        side === 'left' ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    />
  );
}

function CopyButton({
  argv,
  disabled,
}: {
  readonly argv: readonly string[];
  readonly disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1400);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? 'Command copied' : 'Copy command'}
      title={copied ? 'Copied' : 'Copy command'}
      disabled={disabled}
      onClick={() => {
        // The full argv, including the real paths the bar abbreviates. What is
        // copied has to be what runs, or the bar is decoration.
        navigator.clipboard.writeText(commandToString(argv)).then(
          () => {
            setCopied(true);
          },
          () => {
            // Clipboard permission can be refused outright. Saying nothing is
            // better than a false tick claiming it was copied.
            setCopied(false);
          },
        );
      }}
      className={cn(
        'shrink-0 rounded-button p-2 transition-colors duration-100',
        copied ? 'text-token-path' : 'text-token-binary',
        'hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      {copied ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
    </button>
  );
}

/**
 * The Run button *becomes* the progress bar, rather than a progress row
 * appearing elsewhere and shifting the layout. The thing you pressed is the
 * thing that reports.
 *
 * The label is drawn twice — once dark, clipped to the filled region, once light
 * over the unfilled one. A single colour cannot work, because the text sits
 * across the moving boundary and white on `--signal` is only 2.2:1.
 */
function RunControl({
  run,
  canRun,
  onRun,
  onCancel,
}: {
  readonly run: RunState;
  readonly canRun: boolean;
  readonly onRun: () => void;
  readonly onCancel: () => void;
}) {
  if (run.status === 'running') {
    const percent = Math.round(run.progress * 100);
    const label = `${run.passCount > 1 ? `${run.passLabel} · ` : ''}${String(percent)}%  ${formatElapsed(run.elapsedMs)}`;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <div
          className="bg-well relative overflow-hidden rounded-button border border-white/15"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Operation progress"
        >
          <div className="text-mono px-4 py-2 whitespace-nowrap text-white tabular-nums">
            {label}
          </div>
          <div
            className="bg-signal absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-150"
            style={{ width: `${String(percent)}%` }}
          >
            <div className="text-mono text-well px-4 py-2 whitespace-nowrap tabular-nums">
              {label}
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cancel"
          title="Cancel"
          onClick={onCancel}
          className="text-token-binary shrink-0 rounded-button p-2 transition-colors duration-100 hover:bg-white/10"
        >
          <X aria-hidden size={15} />
        </button>
      </div>
    );
  }

  if (run.status === 'done') {
    return (
      <a
        href={downloadUrl(run.outputId)}
        download={run.outputName}
        className="text-body bg-token-path text-well flex shrink-0 items-center gap-1.5 rounded-button px-4 py-2 font-medium tabular-nums"
      >
        <Download aria-hidden size={14} />
        {formatBytes(run.sizeBytes)}, {formatElapsed(run.elapsedMs)}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={!canRun}
      onClick={onRun}
      className={cn(
        'text-body flex shrink-0 items-center gap-1.5 rounded-button px-4 py-2 font-medium',
        'bg-accent text-white transition-opacity duration-100',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      Run
      <Play aria-hidden size={13} fill="currentColor" />
    </button>
  );
}

function formatElapsed(ms: number): string {
  // A stream copy of a short clip genuinely finishes in tens of milliseconds.
  // Rounding that to "0.0s" reads as a broken timer rather than a fast one.
  if (ms < 1000) return `${String(Math.max(1, Math.round(ms)))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${String(Math.floor(seconds / 60))}m ${String(Math.round(seconds % 60))}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
