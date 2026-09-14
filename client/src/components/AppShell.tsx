import { Settings } from 'lucide-react';
import { Link } from 'react-router';

import { CommandBar } from '@/components/CommandBar';
import { Rail } from '@/components/Rail';
import { SAMPLE_ARGV } from '@/lib/sample-command';
import { useScrubStore } from '@/store/use-scrub-store';

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

  return (
    // `grid-cols-[minmax(0,1fr)]` is load-bearing: a grid's implicit column is
    // `auto`, which resolves to max-content, so without it the rail's row of
    // operations sets the width of the whole page and the body scrolls sideways.
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="border-line bg-paper flex items-center gap-4 border-b px-4 py-3">
        <Link to="/" className="text-heading text-ink rounded-button font-semibold">
          Scrub
        </Link>
        <div className="min-w-0 flex-1 text-center">
          {meta ? (
            <p className="text-body text-ink truncate">{meta.displayName}</p>
          ) : (
            <p className="text-label text-muted truncate">No file loaded</p>
          )}
        </div>
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

      <CommandBar argv={SAMPLE_ARGV} placeholder />
    </div>
  );
}
