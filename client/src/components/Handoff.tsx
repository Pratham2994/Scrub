import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { HANDOFF, handoffVariants } from '@/lib/motion';

type HandoffProps = {
  /** Which side of the moment this is. A change here is what animates. */
  readonly mode: 'empty' | 'loaded';
  readonly children: ReactNode;
};

/**
 * The one orchestrated moment in Scrub: the dropzone collapsing into the
 * workspace when a file lands.
 *
 * It earns the exception because it is the only point where the screen becomes
 * a different screen. Everything before it is an invitation and everything
 * after it is work, and without a transition the swap reads as a page load -
 * which is exactly the confusion the upload states were added to fix. A file
 * arriving should look like it arrived *here*.
 *
 * `popLayout` takes the outgoing dropzone out of flow, so the workspace claims
 * its position immediately and the dashed frame shrinks away over the top of
 * it. The alternative, both children in flow at once, makes the panel briefly
 * as tall as the two of them together and the layout jumps.
 */
export function Handoff({ mode, children }: HandoffProps) {
  const reduced = useReducedMotion() ?? false;
  const variants = handoffVariants(reduced);

  return (
    /**
     * No `min-h-0` on either box, deliberately.
     *
     * As a `flex-1` item its automatic minimum was zero, so the column shrank
     * it well below its contents - measured at 256px around a 440px panel - and
     * the controls simply overflowed it. Nothing clipped them, so they looked
     * fine, but they were painted over whatever came next: the failure card sat
     * correctly at 411..765 and was invisible underneath them. `will-change:
     * transform` on the inner box makes that worse by promoting it above later
     * siblings in paint order.
     *
     * Leaving the minimum at `auto` makes both boxes refuse to shrink below
     * their content, and `main` scrolls instead, which is what it is for.
     */
    <div className="relative flex flex-1 flex-col">
      <AnimatePresence
        mode="popLayout"
        // No animation on the first paint. A reload with a file already restored
        // is not a file landing, and animating it would claim something happened
        // that did not.
        initial={false}
      >
        <motion.div
          key={mode}
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={HANDOFF}
          // Scale on a panel full of text softens the type for the length of the
          // transition; telling the browser in advance keeps it sharp.
          style={{ willChange: reduced ? 'opacity' : 'transform, opacity' }}
          className="flex flex-1 flex-col gap-4"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
