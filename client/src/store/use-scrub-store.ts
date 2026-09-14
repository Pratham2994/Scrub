import type { OperationKind, ProbeResult } from '@scrub/shared';
import { create } from 'zustand';

/**
 * One workspace, so one store. The loaded file *is* the state — routes swap the
 * centre panel, they do not swap what is loaded.
 *
 * Deliberately thin for now: upload, probe, run and progress land here as they are
 * built, and nothing else should.
 */
export type ScrubState = {
  /** Server-side upload id, or null when nothing is loaded. */
  readonly uploadId: string | null;
  readonly meta: ProbeResult | null;
  readonly activeOperation: OperationKind | null;

  readonly setActiveOperation: (kind: OperationKind | null) => void;
  readonly loadUpload: (uploadId: string, meta: ProbeResult) => void;
  readonly reset: () => void;
};

export const useScrubStore = create<ScrubState>()((set) => ({
  uploadId: null,
  meta: null,
  activeOperation: null,

  setActiveOperation: (kind) => {
    set({ activeOperation: kind });
  },
  loadUpload: (uploadId, meta) => {
    set({ uploadId, meta });
  },
  reset: () => {
    set({ uploadId: null, meta: null, activeOperation: null });
  },
}));
