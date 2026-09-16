import { availabilityOf, OPERATIONS, type OperationGroup } from '@scrub/shared';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/use-theme';
import { useScrubStore } from '@/store/use-scrub-store';

const GROUPS: readonly { readonly id: OperationGroup; readonly label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
];

/**
 * Labels, no icons. Eleven operations would mean eleven icons that each
 * half-describe a verb, and "compress" has no good glyph. Words are unambiguous
 * and this audience reads.
 *
 * The groups are marked by micro labels sitting in hairlines - "Video" above the
 * video operations, "Audio" between the groups. They are separators with a word
 * in them, not headings, so they mark the split without competing with the verbs.
 *
 * The active operation is a dark chip with an accent tick. The dark marks the
 * three places where the work happens - the picture (well), the command (bar),
 * and the selection (here) - and the tick ties the selection to the focus ring,
 * which is the only other place accent appears in the chrome.
 *
 * Below 900px the rail lies down into a horizontal scroller; the legends go and
 * a bare vertical hairline keeps the groups apart.
 */
export function Rail() {
  const meta = useScrubStore((state) => state.meta);
  const { theme } = useTheme();
  const phosphor = theme === 'phosphor';
  const railRef = useRef<HTMLElement>(null);
  /**
   * Whether there are operations below the fold.
   *
   * Fourteen of them do not fit a laptop shorter than about 560px once the
   * header and command bar have taken their share, and a list that is quietly
   * cut off is worse than one that is visibly scrollable: the operation you are
   * looking for appears not to exist.
   */
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > 2;
    setClipped((previous) => (previous === more ? previous : more));
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return (
    <nav
      ref={railRef}
      onScroll={measure}
      aria-label="Operations"
      className={cn(
        'border-line bg-paper flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b px-3 py-2',
        /**
         * The strip is the default (it is also the below-900px layout), and
         * the `workspace:` classes turn it into the vertical rail at desktop
         * width. Tube keeps the strip at every width, so the classes are
         * dropped entirely rather than fought by the media query.
         */
        !phosphor && [
          'workspace:w-rail workspace:flex-col workspace:gap-0 workspace:overflow-x-visible',
          'workspace:overflow-y-auto workspace:border-r workspace:border-b-0 workspace:px-3',
          /**
           * Tighter on a short screen. Fourteen operations plus two legends need
           * about 540px, and a 1366x768 laptop leaves the rail roughly 478 - so
           * Loudness sat below the fold with nothing saying there was more. The
           * padding goes before the labels do.
           */
          'workspace:py-2 tall:workspace:py-4',
        ],
      )}
    >
      {GROUPS.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 && (
            /**
             * The bare hairline between the groups. In the vertical rail the
             * groups are far enough apart to not need it, so `workspace:hidden`
             * removes it at desktop width - which Tube must not inherit, since
             * its strip is the below-900px layout at every width.
             */
            <div
              aria-hidden
              className={cn(
                'bg-line mx-2 w-px shrink-0 self-stretch',
                !phosphor && 'workspace:hidden',
              )}
            />
          )}
          {/* The strip has no room for the legends; the hairline above carries
              the group split. Hidden at the call site rather than by class,
              because `workspace:flex` inside the legend would show it again at
              desktop width in Tube. */}
          {!phosphor && <GroupLegend label={group.label} spaced={index > 0} />}
          <div className={cn('flex shrink-0 items-center gap-1', !phosphor && 'workspace:block')}>
            {OPERATIONS.filter((op) => op.group === group.id).map((op) => {
              // Nothing loaded yet, so nothing is ruled out.
              const status = meta === null ? null : availabilityOf(op.kind, meta);
              const blocked = status?.state === 'unavailable';
              return (
                <NavLink
                  key={op.kind}
                  to={`/op/${op.kind}`}
                  /**
                   * Dimmed, not hidden, and still reachable. An operation that
                   * vanishes leaves the user wondering whether they misremembered
                   * it; one that is visibly unavailable and says why on the way in
                   * teaches them something about their file.
                   */
                  title={blocked ? status.reason : undefined}
                  /**
                   * "Convert" and "Trim" each appear in both groups. Sighted users
                   * tell them apart by the legend above; anyone listening hears
                   * two identical links, so the accessible name carries the group
                   * even though the visible label stays the short verb.
                   */
                  aria-label={group.id === 'audio' ? `${op.label} audio` : op.label}
                  className={({ isActive }) =>
                    cn(
                      'text-body relative block shrink-0 rounded-button px-2 whitespace-nowrap transition-colors duration-100',
                      phosphor ? 'py-1.5' : 'py-1.5 short:workspace:py-1',
                      isActive
                        ? /**
                           * Inverted against the invert tokens, which light and
                           * dark keep at the well colours and Tube sets to
                           * white phosphor: a world where everything is dark
                           * needs a selection that is not.
                           */
                          'bg-invert text-on-invert font-medium'
                        : blocked
                          ? /**
                             * Struck through rather than faded.
                             *
                             * `text-muted/45` measured 1.88:1 against paper in
                             * both themes, and these are focusable links with a
                             * tooltip, so that is an interactive control below
                             * even the 3:1 floor. Opacity cannot carry
                             * "unavailable" and stay legible: the band between
                             * visibly dimmer and 4.5:1 is too narrow to read.
                             * The line carries the meaning instead, which also
                             * means it no longer depends on colour at all.
                             */
                            'text-muted line-through decoration-line-strong/70 hover:text-ink'
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
              );
            })}
          </div>
        </Fragment>
      ))}
      {clipped && (
        /**
         * Sticky rather than absolute: the nav is the scroll container, so an
         * absolutely positioned fade would scroll away with the content it is
         * meant to be hinting at.
         */
        <div
          aria-hidden
          className={cn(
            'from-paper pointer-events-none sticky bottom-0 -mt-6 hidden h-6 bg-gradient-to-t to-transparent',
            !phosphor && 'workspace:block',
          )}
        />
      )}
    </nav>
  );
}

/**
 * "── Audio ──" - a micro label sitting in a hairline. In the horizontal rail
 * (below 900px) there is no room for a legend, so it collapses to nothing and
 * the bare vertical divider above takes over.
 */
function GroupLegend({ label, spaced }: { readonly label: string; readonly spaced: boolean }) {
  return (
    <div
      className={cn(
        'hidden items-center gap-2 workspace:flex',
        spaced ? 'workspace:my-2 tall:workspace:my-4' : 'workspace:mb-2 tall:workspace:mb-4',
      )}
    >
      <span aria-hidden className="bg-line h-px flex-1" />
      <h2 className="text-micro text-muted px-1 font-medium">{label}</h2>
      <span aria-hidden className="bg-line h-px flex-1" />
    </div>
  );
}
