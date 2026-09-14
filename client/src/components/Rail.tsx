import { OPERATIONS, type OperationGroup } from '@scrub/shared';
import { Fragment } from 'react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

const GROUPS: readonly { readonly id: OperationGroup }[] = [{ id: 'video' }, { id: 'audio' }];

/**
 * Labels, no icons. Eleven operations would mean eleven icons that each
 * half-describe a verb, and "compress" has no good glyph. Words are unambiguous
 * and this audience reads.
 *
 * No group headings: "Convert" and "Trim" appear in both groups, so a hairline
 * with a little air is the separator, not a label that competes with the verbs.
 *
 * The active operation is a dark chip on purpose. The dark marks the three places
 * where the work happens — the picture (well), the command (bar), and the
 * selection (here). Everything else stays quiet.
 *
 * Below 900px the rail lies down into a horizontal scroller and the divider
 * becomes a vertical hairline.
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
            <div
              aria-hidden
              className="bg-line mx-2 w-px shrink-0 self-stretch workspace:mx-3 workspace:my-4 workspace:h-px"
            />
          )}
          <div className="flex shrink-0 items-center gap-1 workspace:block">
            {OPERATIONS.filter((op) => op.group === group.id).map((op) => (
              <NavLink
                key={op.kind}
                to={`/op/${op.kind}`}
                className={({ isActive }) =>
                  cn(
                    'text-body block shrink-0 rounded-button px-2 py-1.5 whitespace-nowrap transition-colors duration-100',
                    isActive
                      ? 'bg-well text-white font-medium'
                      : 'text-muted hover:text-ink hover:bg-surface/70',
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
