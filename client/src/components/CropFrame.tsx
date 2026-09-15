import type { ProbeResult } from '@scrub/shared';
import { useCallback, useRef } from 'react';

import { sourceUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * The crop rectangle, dragged over a real frame from the file.
 *
 * DESIGN.md's rule for what earns screen space is whether it comes from the
 * user's own data, and this is the clearest case of it in the product: the
 * thing you are cutting is drawn on the thing you are cutting it out of. A pair
 * of width and height boxes would be the same operation and a worse answer to
 * "is the subject still in shot".
 *
 * The rectangle lives in the store as fractions of the frame rather than
 * pixels, so the same selection means the same crop whatever size the window
 * happens to be, and it survives the preview being resized mid-drag.
 */

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** Nothing smaller than this, as a fraction — below it the handles overlap. */
const MIN = 0.05;

export function CropFrame({ id, meta }: { readonly id: string; readonly meta: ProbeResult }) {
  const crop = useScrubStore((state) => state.params.crop);
  const setParams = useScrubStore((state) => state.setParams);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    from: typeof crop;
  } | null>(null);

  const clamp = (value: number): number => Math.min(1, Math.max(0, value));

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current;
      const box = boxRef.current?.getBoundingClientRect();
      if (!drag || !box || box.width === 0 || box.height === 0) return;

      const dx = (event.clientX - drag.startX) / box.width;
      const dy = (event.clientY - drag.startY) / box.height;
      const from = drag.from;

      if (drag.handle === 'move') {
        // Moving cannot push the rectangle off the frame; it stops at the edge
        // rather than shrinking, which is what dragging something expects to do.
        setParams('crop', {
          x: Math.min(1 - from.width, Math.max(0, from.x + dx)),
          y: Math.min(1 - from.height, Math.max(0, from.y + dy)),
        });
        return;
      }

      const west = drag.handle === 'nw' || drag.handle === 'sw';
      const north = drag.handle === 'nw' || drag.handle === 'ne';

      // The corner opposite the one being dragged stays put, which is the whole
      // point of dragging a corner.
      const right = from.x + from.width;
      const bottom = from.y + from.height;

      const nextX = west ? clamp(Math.min(from.x + dx, right - MIN)) : from.x;
      const nextY = north ? clamp(Math.min(from.y + dy, bottom - MIN)) : from.y;
      const nextRight = west ? right : clamp(Math.max(right + dx, from.x + MIN));
      const nextBottom = north ? bottom : clamp(Math.max(bottom + dy, from.y + MIN));

      setParams('crop', {
        x: nextX,
        y: nextY,
        width: nextRight - nextX,
        height: nextBottom - nextY,
      });
    },
    [setParams],
  );

  const begin = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, from: crop };
  };

  const end = (event: React.PointerEvent): void => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const percent = (value: number): string => `${String(value * 100)}%`;
  const aspect = meta.video === null ? 16 / 9 : meta.video.width / meta.video.height;

  return (
    <div
      ref={boxRef}
      className="bg-well border-well-edge relative mx-auto w-full overflow-hidden rounded-control border select-none"
      style={{ aspectRatio: String(aspect), maxHeight: '22rem' }}
    >
      {/* A still, not the player. There are no controls to fight with and no
          chance of the crop box being dragged onto a seek bar. */}
      <video
        src={sourceUrl(id)}
        muted
        playsInline
        preload="metadata"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-45"
      />

      {/* The kept region at full strength. Everything outside stays visible and
          dimmed, the same way the filmstrip shows what is being trimmed away:
          you can see what you are losing, which is the point of showing it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          clipPath: `inset(${percent(crop.y)} ${percent(1 - crop.x - crop.width)} ${percent(1 - crop.y - crop.height)} ${percent(crop.x)})`,
        }}
      >
        <video
          src={sourceUrl(id)}
          muted
          playsInline
          preload="metadata"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>

      <div
        role="group"
        aria-label="Crop rectangle"
        onPointerDown={begin('move')}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        className="border-accent absolute cursor-move touch-none border-2"
        style={{
          left: percent(crop.x),
          top: percent(crop.y),
          width: percent(crop.width),
          height: percent(crop.height),
        }}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <button
            key={corner}
            type="button"
            aria-label={`${CORNER_LABEL[corner]} corner`}
            onPointerDown={begin(corner)}
            onPointerMove={onPointerMove}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(event) => {
              // Keyboard reachable, like every other control here. A crop is one
              // of the easiest things to want to nudge by exactly one step.
              const step = event.shiftKey ? 0.05 : 0.01;
              const map: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const delta = map[event.key];
              if (!delta) return;
              event.preventDefault();
              const [dx, dy] = delta;
              const west = corner === 'nw' || corner === 'sw';
              const north = corner === 'nw' || corner === 'ne';
              const right = crop.x + crop.width;
              const bottom = crop.y + crop.height;
              const x = west ? clamp(Math.min(crop.x + dx, right - MIN)) : crop.x;
              const y = north ? clamp(Math.min(crop.y + dy, bottom - MIN)) : crop.y;
              const nextRight = west ? right : clamp(Math.max(right + dx, x + MIN));
              const nextBottom = north ? bottom : clamp(Math.max(bottom + dy, y + MIN));
              setParams('crop', { x, y, width: nextRight - x, height: nextBottom - y });
            }}
            className={cn(
              'bg-accent absolute h-3.5 w-3.5 touch-none rounded-sm',
              corner === 'nw' && '-top-2 -left-2 cursor-nwse-resize',
              corner === 'ne' && '-top-2 -right-2 cursor-nesw-resize',
              corner === 'sw' && '-bottom-2 -left-2 cursor-nesw-resize',
              corner === 'se' && '-right-2 -bottom-2 cursor-nwse-resize',
            )}
          />
        ))}
      </div>
    </div>
  );
}

const CORNER_LABEL: Record<Exclude<Handle, 'move'>, string> = {
  nw: 'Top left',
  ne: 'Top right',
  sw: 'Bottom left',
  se: 'Bottom right',
};
