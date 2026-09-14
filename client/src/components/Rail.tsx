import { OPERATIONS, type OperationGroup } from '@scrub/shared';
import { Fragment } from 'react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

const GROUPS: readonly { readonly id: OperationGroup; readonly label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
];

/**
 * Labels, no icons. Eleven operations would mean eleven icons that each
 * half-describe a verb, and "compress" has no good glyph. Words are unambiguous
 * and this audience reads.
 *
 * The groups are marked by micro labels sitting in hairlines — "Video" above the
 * video operations, "Audio" between the groups. They are separators with a word
 * in them, not headings, so they mark the split without competing with the verbs.
 *
 * The active operation is a dark chip with an accent tick. The dark marks the
 * three places where the work happens — the picture (well), the command (bar),
 * and the selection (here) — and the tick ties the selection to the focus ring,
 * which is the only other place accent appears in the chrome.
 *
 * Below 900px the rail lies down into a horizontal scroller; the legends go and
 * a bare vertical hairline keeps the groups apart.
 */
export function Rail() {
  return (
    <nav
      aria-label="Operations"
      className={cn(
        'border-line bg-paper flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b px-3 py-2',
        'workspace:w-rail workspace:flex-col workspace:gap-0 workspace:overflow-x-visible',
        'workspace:overflow-y-auto workspace:border-r workspace:border-b-0 workspace:px-3 workspace:py-4',
      )}
    >
      {GROUPS.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 && (
            <div aria-hidden className="bg-line mx-2 w-px shrink-0 self-stretch workspace:hidden" />
          )}
          <GroupLegend label={group.label} spaced={index > 0} />
          <div className="flex shrink-0 items-center gap-1 workspace:block">
            {OPERATIONS.filter((op) => op.group === group.id).map((op) => (
              <NavLink
                key={op.kind}
                to={`/op/${op.kind}`}
                className={({ isActive }) =>
                  cn(
                    'text-body relative block shrink-0 rounded-button px-2 py-1.5 whitespace-nowrap transition-colors duration-100',
                    isActive
                      ? 'bg-well text-white font-medium'
                      : 'text-muted hover:text-ink hover:bg-surface/70',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span
                        aria-hidden
                        className="bg-accent absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full"
                      />
                    )}
                    {op.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * "── Audio ──" — a micro label sitting in a hairline. In the horizontal rail
 * (below 900px) there is no room for a legend, so it collapses to nothing and
 * the bare vertical divider above takes over.
 */
function GroupLegend({ label, spaced }: { readonly label: string; readonly spaced: boolean }) {
  return (
    <div
      className={cn(
        'hidden items-center gap-2 workspace:flex',
        spaced ? 'workspace:my-4' : 'workspace:mb-4',
      )}
    >
      <span aria-hidden className="bg-line h-px flex-1" />
      <h2 className="text-micro text-muted px-1 font-medium">{label}</h2>
      <span aria-hidden className="bg-line h-px flex-1" />
    </div>
  );
}
