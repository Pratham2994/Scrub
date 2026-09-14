import type { Operation } from '@scrub/shared';
import { z } from 'zod';

/** Upload ids are minted with `crypto.randomUUID`, and only ever matched, never joined raw. */
export const idSchema = z.uuid();

export const idParamsSchema = z.object({ id: idSchema });

/**
 * Runtime mirror of the shared `Operation` union.
 *
 * `satisfies z.ZodType<Operation>` is the point of this file: if the union gains a
 * member or changes a field and this schema does not follow, the build fails here
 * instead of at Run with a validation error nobody can explain.
 */
export const operationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('trim'),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
    mode: z.enum(['fast', 'precise']),
  }),
  z.object({
    kind: z.literal('compress'),
    crf: z.number().int().min(0).max(51),
    preset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow', 'veryslow']),
  }),
  z.object({
    kind: z.literal('convert'),
    container: z.enum(['mp4', 'webm', 'mkv', 'mov']),
  }),
  z.object({
    kind: z.literal('resize'),
    // libx264 needs even dimensions; the scaler is given `-2` for height so it
    // rounds. An odd *width* asked for here would still break the encode.
    width: z.number().int().positive().multipleOf(2),
  }),
  z.object({
    kind: z.literal('gif'),
    fps: z.number().int().min(1).max(50),
    width: z.number().int().positive().multipleOf(2),
    startSec: z.number().nonnegative().nullable(),
    endSec: z.number().positive().nullable(),
  }),
  z.object({
    kind: z.literal('extract-audio'),
    format: z.enum(['mp3', 'aac', 'wav', 'flac', 'opus']),
  }),
  z.object({ kind: z.literal('mute') }),
  z.object({
    kind: z.literal('replace-audio'),
    audioId: idSchema,
  }),
  z.object({
    kind: z.literal('audio-convert'),
    format: z.enum(['mp3', 'aac', 'wav', 'flac', 'opus']),
    bitrateKbps: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: z.literal('audio-trim'),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
  }),
  z.object({
    kind: z.literal('loudness'),
    targetI: z.number().min(-70).max(-5),
    targetTP: z.number().min(-9).max(0),
    targetLRA: z.number().min(1).max(50),
  }),
]) satisfies z.ZodType<Operation>;

/**
 * A run is either one of the eleven operations, or a command the user edited by
 * hand. The second form is what keeps the operation list closed: anything Scrub
 * does not offer is reachable by typing it, and that is a feature rather than a
 * gap.
 *
 * It is only defensible because the server is bound to loopback. The argv is
 * capped so a single request cannot hand ffmpeg an unbounded argument list.
 */
export const runRequestSchema = z.union([
  z.object({ id: idSchema, op: operationSchema }),
  z.object({
    id: idSchema,
    argv: z.array(z.string().max(4096)).min(1).max(256),
  }),
]);

export type RunRequest = z.infer<typeof runRequestSchema>;
