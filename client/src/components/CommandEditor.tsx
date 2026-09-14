import {
  type Diagnostic,
  formatCommandLine,
  type LintContext,
  lintCommand,
  parseCommandLine,
} from '@scrub/shared';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type EditorResult = {
  readonly argv: readonly string[] | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly parseError: string | null;
};

/** Parse and lint in one place, so the editor and the Run button agree. */
export function analyse(text: string, context: LintContext): EditorResult {
  const parsed = parseCommandLine(text);
  if (!parsed.ok) {
    return { argv: null, diagnostics: [], parseError: parsed.error };
  }
  const diagnostics = lintCommand(parsed.argv, context);
  return { argv: parsed.argv, diagnostics, parseError: null };
}

export function hasBlockingError(result: EditorResult): boolean {
  return result.parseError !== null || result.diagnostics.some((d) => d.severity === 'error');
}

type CommandEditorProps = {
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly result: EditorResult;
};

const SEVERITY_STYLE: Record<Diagnostic['severity'], { icon: typeof Info; className: string }> = {
  error: { icon: XCircle, className: 'text-[#ff9b92]' },
  warning: { icon: AlertTriangle, className: 'text-token-value' },
  info: { icon: Info, className: 'text-token-flag' },
};

/**
 * The editable form of the command.
 *
 * A textarea rather than a contenteditable: the command is plain text, and a
 * textarea gets selection, undo, and the platform's own editing behaviour for
 * free. It wraps, because a hand-edited command is being read carefully rather
 * than glanced at, and horizontal scrolling while typing is miserable.
 *
 * Diagnostics appear as you type and never block typing — only Run is withheld,
 * and only for things that genuinely cannot run.
 */
export function CommandEditor({ text, onTextChange, result }: CommandEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dismissed, setDismissed] = useState(false);

  // Focus on open, cursor at the end rather than selecting everything — the user
  // came to adjust a flag, not to replace the line.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${String(Math.min(element.scrollHeight, 240))}px`;
  }, [text]);

  const visible = useMemo(
    () => (dismissed ? [] : result.diagnostics.slice(0, 4)),
    [result.diagnostics, dismissed],
  );
  const hidden = result.diagnostics.length - visible.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 py-3">
      <textarea
        ref={textareaRef}
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label="Edit the command"
        onChange={(event) => {
          setDismissed(false);
          onTextChange(event.target.value);
        }}
        className={cn(
          'text-mono text-token-binary w-full resize-none rounded-control bg-white/5 px-3 py-2 tabular-nums',
          'border border-white/15 outline-none focus-visible:border-accent',
        )}
      />

      {result.parseError !== null && <Row severity="error" message={result.parseError} />}

      {visible.map((diagnostic, index) => (
        <Row
          key={`${diagnostic.message}-${String(index)}`}
          severity={diagnostic.severity}
          message={diagnostic.message}
          // Indices come from linting the *edited* argv, so the fix has to be
          // applied to that same array. Using the generated one would rewrite
          // whichever token happened to sit at the same position.
          fix={result.argv === null ? undefined : makeFix(diagnostic, result.argv, onTextChange)}
        />
      ))}

      {hidden > 0 && !dismissed && (
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
          }}
          className="text-micro text-token-transport self-start hover:text-token-binary"
        >
          {hidden} more — hide all
        </button>
      )}
    </div>
  );
}

/**
 * A one-click correction, for diagnostics that name both a token and what it
 * should say. Narrowed here rather than inline so the closure captures real
 * values instead of asserting the nullable fields away.
 */
function makeFix(
  diagnostic: Diagnostic,
  argv: readonly string[],
  onTextChange: (text: string) => void,
): (() => void) | undefined {
  const { tokenIndex, fix } = diagnostic;
  if (tokenIndex === null || fix === null) return undefined;
  return () => {
    const next = [...argv];
    next[tokenIndex] = fix;
    onTextChange(formatCommandLine(next));
  };
}

function Row({
  severity,
  message,
  fix,
}: {
  readonly severity: Diagnostic['severity'];
  readonly message: string;
  readonly fix?: (() => void) | undefined;
}) {
  const { icon: Icon, className } = SEVERITY_STYLE[severity];
  return (
    <div className="flex items-start gap-2">
      <Icon aria-hidden size={13} className={cn('mt-0.5 shrink-0', className)} />
      <p className="text-micro text-token-binary min-w-0 flex-1">
        {message}
        {fix && (
          <button
            type="button"
            onClick={fix}
            className="text-token-path ml-2 underline underline-offset-2"
          >
            Fix
          </button>
        )}
      </p>
    </div>
  );
}
