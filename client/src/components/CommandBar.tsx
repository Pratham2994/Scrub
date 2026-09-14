import { formatCommandLine, type LintContext } from '@scrub/shared';
import { Check, Copy, Pencil, Play, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { analyse, CommandEditor, hasBlockingError } from '@/components/CommandEditor';
import { commandToString, type CommandToken, tokenizeCommand } from '@/lib/command-tokens';
import { cn } from '@/lib/utils';
import type { CommandPassView } from '@/lib/use-command';
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
  /** Every pass. More than one means the operation runs several commands. */
  readonly passes: readonly CommandPassView[];
  readonly placeholder?: boolean;
  readonly run: RunState;
  readonly canRun: boolean;
  /** Null when nothing is loaded, which is also when editing makes no sense. */
  readonly lintContext: LintContext | null;
  /** Called with the generated argv, or the edited one when the user has changed it. */
  readonly onRun: (argv: readonly string[] | null) => void;
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
  passes,
  placeholder = false,
  run,
  canRun,
  lintContext,
  onRun,
  onCancel,
}: CommandBarProps) {
  const scrollRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [editing, setEditing] = useState(false);
  /**
   * The user's edit, or null when they have not made one.
   *
   * Kept separately from `editing` on purpose: closing the editor should put the
   * pencil away, not throw the work away. The edit survives until it is reset or
   * until the command it was based on is replaced.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [passIndex, setPassIndex] = useState(0);

  const generatedLine = useMemo(
    () => formatCommandLine(['ffmpeg', ...(passes[passIndex]?.argv ?? argv)]),
    [passes, passIndex, argv],
  );
  const text = draft ?? generatedLine;
  const dirty = draft !== null && draft !== generatedLine;

  // A new file or a different operation makes the edit meaningless — it described
  // a command against something else, and silently running it would be worse
  // than dropping it.
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setPassIndex(0);
  }, [argv]);

  /**
   * Only parse and lint when there is something hand-written to check.
   *
   * `text` follows the generated command when there is no draft, so without this
   * guard every drag of a trim handle re-parsed and re-linted a command Scrub
   * wrote itself — sixty times a second, to reach the same conclusion each time.
   */
  const active = editing || draft !== null;
  const analysis = useMemo(
    () => (active && lintContext ? analyse(text, lintContext) : null),
    [active, text, lintContext],
  );
  const blocked = dirty && analysis !== null && hasBlockingError(analysis);
  const edited = useMemo(() => {
    if (!dirty || !analysis?.argv) return null;
    // The editor shows "ffmpeg …" because that is the command; spawn is given
    // everything *after* the program name, so the binary comes back off here.
    const parsed = analysis.argv;
    return parsed[0] === 'ffmpeg' ? parsed.slice(1) : parsed;
  }, [dirty, analysis]);

  // What the collapsed bar renders: the edit if there is one, otherwise the
  // generated command. Either way it is what Run will execute.
  const selected = passes[Math.min(passIndex, passes.length - 1)]?.argv ?? argv;
  const shown = edited ?? selected;
  // Tokenising is pure and the result only changes when the command does, but
  // this component re-renders on every progress tick during an encode.
  const tokens = useMemo(() => tokenizeCommand(shown), [shown]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    // Bail when nothing changed. A fresh object here would re-render on every
    // observation, and this is driven by a ResizeObserver — a render that
    // changes layout feeds the next observation and the loop pins the main
    // thread, which looks exactly like the page freezing.
    setEdges((previous) =>
      previous.left === left && previous.right === right ? previous : { left, right },
    );
  }, []);

  // One observer for the element's lifetime. It reports size changes; tearing it
  // down and rebuilding it whenever the command changed was pure overhead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  // Whether a fade belongs there is a fact about the content, so re-measure when
  // the content changes.
  useEffect(measure, [measure, tokens]);

  return (
    <div
      className="bg-well relative flex min-h-commandbar shrink-0 items-start gap-3 px-4 workspace:items-center"
      style={{ boxShadow: '0 -1px 0 var(--color-line)' }}
    >
      {editing && analysis !== null ? (
        <CommandEditor text={text} onTextChange={setDraft} result={analysis} />
      ) : (
        <div className="relative min-w-0 flex-1 self-center">
          <code
            ref={scrollRef}
            onScroll={measure}
            tabIndex={0}
            className={cn(
              'text-mono block overflow-x-auto whitespace-nowrap tabular-nums',
              // A thin visible track: with the scrollbar hidden entirely there is
              // nothing telling a mouse user the rest of the command is there.
              '[scrollbar-color:theme(colors.token-transport)_transparent] [scrollbar-width:thin]',
              placeholder && 'opacity-60',
            )}
            aria-label={placeholder ? 'Example command' : 'Command that will run'}
          >
            {tokens.map((token, index) => (
              /**
               * The key is position *and* content, so a span survives as long as
               * the argument at that position is unchanged and re-mounts the
               * moment it is not. That re-mount is what runs `token-change`, and
               * it is why moving one control fades one flag rather than the
               * whole line: the other nineteen spans never went away.
               *
               * `data-motion` marks it as opacity-only, which is what keeps it
               * alive under reduced motion.
               */
              <span
                key={`${String(index)}-${token.full}`}
                data-motion="opacity"
                className={cn('token-change', ROLE_CLASS[token.role])}
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
      )}

      <div className="flex shrink-0 items-center gap-1 self-center">
        {passes.length > 1 && !dirty && (
          /**
           * GIF and loudness genuinely run two commands. Showing only the first
           * would be showing half of what happens, which is exactly what the
           * command bar exists to prevent — so both are reachable, labelled.
           */
          <div className="mr-1 flex items-center gap-0.5" role="group" aria-label="Command passes">
            {passes.map((pass, index) => (
              <button
                key={pass.label}
                type="button"
                aria-pressed={index === passIndex}
                title={pass.label}
                onClick={() => {
                  setPassIndex(index);
                }}
                className={cn(
                  'text-micro rounded-button px-2 py-1 transition-colors duration-100',
                  index === passIndex
                    ? 'bg-white/15 text-token-binary'
                    : 'text-token-transport hover:bg-white/10',
                )}
              >
                {index + 1}. {pass.label}
              </button>
            ))}
          </div>
        )}
        {dirty && (
          // A persisted edit has to announce itself, or the bar silently stops
          // matching the controls above it.
          <button
            type="button"
            onClick={() => {
              setDraft(null);
            }}
            title="Discard the edit and go back to the generated command"
            className="text-micro text-token-value rounded-button border border-current/40 px-2 py-1"
          >
            Edited · reset
          </button>
        )}
        <CopyButton argv={shown} disabled={placeholder} />
        <EditButton
          editing={editing}
          disabled={placeholder || lintContext === null}
          onToggle={() => {
            setEditing((value) => !value);
          }}
        />
      </div>
      <RunControl
        run={run}
        // An edited command can run even when the operation itself is not built
        // yet — that is exactly what the editable bar is for.
        canRun={(canRun || edited !== null) && !placeholder && !blocked}
        onRun={() => {
          onRun(edited);
        }}
        onCancel={onCancel}
      />
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

function EditButton({
  editing,
  disabled,
  onToggle,
}: {
  readonly editing: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={editing ? 'Stop editing the command' : 'Edit the command'}
      title={editing ? 'Done editing' : 'Edit command'}
      aria-pressed={editing}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'shrink-0 rounded-button p-2 transition-colors duration-100',
        editing ? 'bg-white/15 text-white' : 'text-token-binary hover:bg-white/10',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      <Pencil aria-hidden size={15} />
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
    /**
     * A pass ffmpeg cannot report a fraction for shows the pass name and the
     * clock, and no percentage.
     *
     * GIF's palette pass writes a single image, so there is no output timeline
     * to divide against. It used to leave the bar frozen at "0%  0ms" for
     * roughly half the job, which is indistinguishable from a hang — and the
     * first thing anyone does about a hang is kill it. A number that is not
     * moving is worse than no number.
     */
    const waiting = !run.determinate;
    const label = `${run.passCount > 1 ? `${run.passLabel} · ` : ''}${waiting ? '' : `${String(percent)}%  `}${formatElapsed(run.elapsedMs)}`;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <div
          className="bg-well relative overflow-hidden rounded-button border border-white/15"
          role="progressbar"
          // An indeterminate bar omits the value rather than claiming zero, which
          // is exactly what a screen reader needs to announce it as busy.
          aria-valuenow={waiting ? undefined : percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={waiting ? `${run.passLabel}, working` : 'Operation progress'}
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
          {waiting && (
            /**
             * A band travelling the length of the button, because the fill has
             * no width to pulse: an unreportable pass starts at the floor of its
             * own slice, which for GIF's first pass is zero. Travelling rather
             * than filling is the point — it says work is happening without
             * claiming to know how much is left.
             */
            <div
              aria-hidden
              data-motion="opacity"
              className="animate-pass-working bg-signal/25 pointer-events-none absolute inset-y-0 w-1/3"
            />
          )}
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

  /**
   * A finished run is reported by the result panel above, which shows what was
   * made and offers to save it. Repeating the download here put two Save
   * buttons on screen for one file, so the bar simply returns to Run: adjust
   * something and go again.
   */

  return (
    <button
      type="button"
      disabled={!canRun}
      onClick={onRun}
      className={cn(
        'text-body flex shrink-0 items-center gap-1.5 rounded-button px-4 py-2 font-medium',
        'bg-accent text-on-accent transition-opacity duration-100',
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
