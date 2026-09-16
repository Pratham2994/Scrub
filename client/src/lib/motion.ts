import type { Transition } from 'motion/react';

/**
 * Every duration in the product, in one place.
 *
 * DESIGN.md allows exactly one orchestrated moment and otherwise only response
 * to an action. Keeping the numbers here rather than scattered through
 * components is what stops a second orchestrated moment appearing by accident.
 */

/**
 * The handoff: the empty-state dropzone collapsing into the workspace when a
 * file lands. 320ms, spring.
 *
 * `bounce` is low on purpose. The overshoot should read as the panel settling
 * into place, not as a bounce - anything springier draws attention to the
 * animation instead of to the file that just arrived.
 */
export const HANDOFF: Transition = { type: 'spring', duration: 0.32, bounce: 0.15 };

/**
 * The filmstrip wipe, in milliseconds because it is driven by a CSS transition
 * rather than by Motion.
 *
 * Matched to the handoff so the frames finish arriving as the panel finishes
 * settling: it is one moment, not two that happen to be near each other.
 */
export const FILMSTRIP_REVEAL_MS = 320;

/**
 * Reduced motion keeps the same moment and drops the movement.
 *
 * Not "no animation": a panel that swaps with no transition at all leaves no
 * evidence of what replaced what. Opacity carries the change without moving
 * anything across the screen, which is the part that causes trouble.
 */
export function handoffVariants(reduced: boolean) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.985, y: 6 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.985 },
  };
}
