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
 * Below 900px the rail lies down into a horizontal scroller. The group headings go
 * with it, which matters more than it looks: "Convert" and "Trim" each appear in
 * both groups, so the divider is the only thing left telling video from audio.
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
          <div className="flex shrink-0 items-center gap-1 workspace:mb-5 workspace:block workspace:last:mb-0">
            <h2 className="text-label text-ink shrink-0 pr-1 font-medium workspace:px-2 workspace:pr-0 workspace:pb-2">
              {group.label}
            </h2>
            {OPERATIONS.filter((op) => op.group === group.id).map((op) => (
              <NavLink
                key={op.kind}
                to={`/op/${op.kind}`}
                className={({ isActive }) =>
                  cn(
                    'text-body block shrink-0 rounded-button px-2 py-1.5 whitespace-nowrap transition-colors duration-100',
                    isActive
                      ? 'bg-surface text-ink font-medium'
                      : 'text-muted hover:text-ink hover:bg-surface/60',
                  )
                }
              >
                {op.label}
              </NavLink>
            ))}
          </div>
        </Fragment>
      ))}
    </nav>
  );
}
