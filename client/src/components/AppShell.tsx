import { Settings } from 'lucide-react';
import { Link } from 'react-router';

import { formatTimecode, type ProbeResult } from '@scrub/shared';

import { CommandBar } from '@/components/CommandBar';
import { Rail } from '@/components/Rail';
import { useCommand } from '@/lib/use-command';
import { useRun } from '@/lib/use-run';
import { useRestoreUpload } from '@/lib/use-upload';
import { useScrubStore } from '@/store/use-scrub-store';

/** The micro line under the file name: what ffprobe actually found. */
function summarise(meta: ProbeResult): string {
  const parts = [formatTimecode(meta.durationSec)];
  if (meta.video) {
    parts.push(`${String(meta.video.width)}×${String(meta.video.height)}`, meta.video.codec);
    if (meta.video.fps !== null) parts.push(`${String(meta.video.fps)} fps`);
  }
  if (meta.audio) parts.push(meta.audio.codec);
  if (meta.sizeBytes > 0) parts.push(formatBytes(meta.sizeBytes));
  return parts.join('  ·  ');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * One workspace: header, rail, centre, command bar. Routes swap the centre panel
 * only — the loaded file is the state, not the page.
 *
 * Rows are `auto / minmax(0, 1fr) / auto` so the centre is the only thing that
 * scrolls and the command bar is on screen from the first second, including on the
 * empty state.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const meta = useScrubStore((state) => state.meta);
  const activeOperation = useScrubStore((state) => state.activeOperation);
  const run = useScrubStore((state) => state.run);
  const clearFile = useScrubStore((state) => state.clearFile);
  const command = useCommand(activeOperation);
  const { start, cancel } = useRun(command.operation);

  // Puts the workspace back after a reload, before anything renders an empty state.
  useRestoreUpload();

  return (
    // `grid-cols-[minmax(0,1fr)]` is load-bearing: a grid's implicit column is
    // `auto`, which resolves to max-content, so without it the rail's row of
    // operations sets the width of the whole page and the body scrolls sideways.
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="border-line bg-paper flex items-center gap-4 border-b px-4 py-3">
        <Link
          to="/"
          className="text-heading text-ink flex items-center gap-2 rounded-button font-semibold"
        >
          {/* The favicon mark: a filmstrip with the accent cursor bar. Small enough
              to be a signature, real enough not to be decoration — it is the tool. */}
          <svg aria-hidden width="16" height="16" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="6" fill="var(--color-well)" />
            <rect
              x="6"
              y="12"
              width="4"
              height="8"
              rx="1"
              fill="var(--color-token-binary)"
              opacity="0.45"
            />
            <rect
              x="12"
              y="12"
              width="4"
              height="8"
              rx="1"
              fill="var(--color-token-binary)"
              opacity="0.45"
            />
            <rect
              x="22"
              y="12"
              width="4"
              height="8"
              rx="1"
              fill="var(--color-token-binary)"
              opacity="0.45"
            />
            <rect x="19" y="6" width="2" height="20" rx="1" fill="var(--color-accent)" />
          </svg>
          Scrub
        </Link>
        <div className="min-w-0 flex-1 text-center">
          {meta ? (
            <>
              <p className="text-body text-ink truncate">{meta.displayName}</p>
              <p className="text-micro text-muted truncate tabular-nums">{summarise(meta)}</p>
            </>
          ) : (
            <p className="text-label text-muted truncate">No file loaded</p>
          )}
        </div>
        {meta && (
          <button
            type="button"
            onClick={clearFile}
            className="text-label text-muted hover:text-ink hover:bg-surface shrink-0 rounded-button px-2 py-1.5 transition-colors duration-100"
          >
            Close file
          </button>
        )}
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="text-muted hover:text-ink hover:bg-surface rounded-button p-1.5 transition-colors duration-100"
        >
          <Settings aria-hidden size={16} />
        </button>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] workspace:grid-cols-[var(--spacing-rail)_minmax(0,1fr)] workspace:grid-rows-1">
        <Rail />
        <main className="min-h-0 overflow-auto p-6">{children}</main>
      </div>

      <CommandBar
        argv={command.argv}
        placeholder={command.placeholder}
        run={run}
        canRun={command.operation !== null}
        onRun={start}
        onCancel={cancel}
      />
    </div>
  );
}
