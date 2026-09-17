# Scrub - the merge suite

Date: 2026-09-16

## The idea

Scrub's charter: the everyday things people do to audio and video, one command bar, no editor. The everyday set has one hole left. People glue clips together, crossfade songs for dance practice, put music under a clip, stamp a logo on it, fade ends, loop a section, and nudge the volume. Every one of those is a sentence in ffmpeg and a struggle in an editor, and until now none of them were in Scrub.

This spec adds seven operations and one button. Merge (video), merge audio, add music, watermark, fade, loop, volume, and Save this frame on the video well.

The line that keeps this out of editor territory: transitions are exactly one kind (crossfade), fade in and out are the only fades, there is no timeline, and nothing per-clip happens inside merge. Trim the clips first, merge after; chaining already makes that natural.

## Quality: the copy discipline

Nothing re-encodes unless ffmpeg forces it, and where it forces it, the defaults are high.

| Operation           | Video stream                              | Audio stream                                       |
| ------------------- | ----------------------------------------- | -------------------------------------------------- |
| Loop                | copied                                    | copied                                             |
| Volume (on a video) | copied                                    | re-encoded, aac 192k                               |
| Add music           | copied                                    | mixed and re-encoded, aac 192k                     |
| Fade                | re-encoded if a video fade is set, crf 20 | re-encoded if an audio fade is set, aac 192k       |
| Watermark           | re-encoded, crf 20                        | copied                                             |
| Merge (video)       | re-encoded, crf 20 (or the quality field) | re-encoded, aac 192k                               |
| Merge audio         | none                                      | re-encoded, aac at the bitrate field, default 192k |

Re-encoding operations that keep a single source's container (watermark, add music, fade on video) reuse convert's codec map for BOTH streams, so a webm stays vp9 and a mov stays h264, and any audio re-encode inside them follows the map too: aac for mp4/mov/mkv, opus for webm. The aac 192k defaults in the table mean "192k in the map's codec". Merge owns its container instead: always mp4 + h264 + aac, because a composition of several files has no single owner, and the merge audio operation writes m4a.

Crf 20 is the default rather than compress's 23 because a merge is the final assembly, and the point of assembling is to keep the quality you started with.

Merge also pins `-pix_fmt yuv420p`. xfade offers libx264 a wider pixel format than the clips had, and taking it produces a High 4:4:4 Predictive file that ffmpeg calls a success and Windows Media Player will not open. The same argument that gives merge its own container gives it its own pixel format: a composition has no single source to inherit from, and the point of joining clips is a file you can send someone.

## The operations

All seven follow the existing operation contract: a pure `buildArgs` in shared, a zod schema mirroring it, availability rules, an output name that says what it is, and a command bar that shows the exact filter graph.

### Merge (video)

- Inputs: the loaded video plus 1 to 3 more videos, ordered by the list in the UI.
- Crossfade: one global duration, 0 to 2s, 0 = hard cut.
- Fade in and fade out on the joined result, 0 to 5s each, 0 = none.
- Quality: crf field, default 20, preset medium.
- Mechanics: every clip is normalized to the first clip's dimensions, frame rate, pixel aspect, and audio rate before the graph (`scale`, `fps`, `setsar`, `aresample`). Video chain: `[0:v][1:v]xfade=transition=fade:duration=d:offset=o1[x1]; [x1][2:v]xfade=...`. Audio chain: chained `acrossfade=d=...` with no offset, because the filter has none: its `o` is a boolean `overlap` (default true) and natively trims the tail of one stream and the head of the next. A clip with no audio gets `anullsrc` spliced in so the chain stays continuous. The xfade offsets are accumulated durations minus overlaps, computed in `buildMerge` from the probes, and snapshot-tested, because getting one of them wrong fails the graph or drops frames silently. Fade in/out are `fade`/`afade` appended at the ends of the joined chain. Output: `<first>-<second>-merge-<n>clips-<fade>s.mp4` next to the first clip.
- Hard rule: all inputs must have video. Audio-only files are refused with the pointer to Merge audio.

### Merge audio

- Inputs: the loaded audio file plus 1 to 11 more, ordered.
- Crossfade: 0 to 10s (songs crossfade longer than clips), 0 = hard cut.
- Fade in and out on the joined result, 0 to 30s.
- Bitrate field, default 192k.
- Mechanics: everything `aresample`d to the first file's rate, then `acrossfade` chained back to back (the filter's overlap mode handles the trim; it has no offset option). Output: m4a, named `mix-<n>tracks-<fade>s.m4a` next to the first file.
- Hard rule: audio-only inputs. Video files are refused with the pointer to Merge.

### Add music

- Inputs: the loaded video plus exactly one audio file.
- Two volume fields: the original audio, 0 to 100%, default 100; the music, 0 to 100%, default 35. 0 = that side muted.
- Mechanics: `[0:a]volume=v1[a1]; [1:a]volume=v2[a2]; [a1][a2]amix=inputs=2:duration=first`. The video stream copies. The mix runs for the shorter of the two durations, which is what "music under a clip" means; a note in the panel says so.
- Output: keeps the source's container and codec map, audio aac 192k. Named `<clip>-music-<song>.mp4`.

### Watermark

- Inputs: the loaded video plus exactly one image (png, jpg, webp).
- Position: nine presets (four corners, four edges, centre), corner default.
- Opacity: 0 to 100%, default 100.
- Mechanics: `[1:v]scale` down to fit at most 25% of the frame width, `format=rgba,colorchannelmixer=aa=opacity`, then `overlay=x:y`. The video re-encodes at crf 20. Output keeps the source's container and codec map. Named `<clip>-watermark-<img>.mp4`.

### Fade

- Fade (video group): fades the picture AND the sound together, both streams re-encoded per the codec map (crf 20 for video, aac 192k for audio). Fading a clip at the end means both, which is what people expect.
- Audio fade (audio group): fades the sound only, 0 to 10s each side, both 0 refused (it would write an identical file). On a video it copies the picture untouched, the same argument as Loudness.
- Named `fade-<in>s-<out>s`.

### Loop

- One file, video or audio, 2 to 16 times.
- Mechanics: `-stream_loop n -i in -c copy out`. No re-encode, near-instant, byte-faithful. Named `loop-<n>x`.

### Volume

- One file, video or audio, -20 to +20 dB, default +6.
- Video: `-c:v copy -af volume=XdB`, the picture copies untouched. Audio-only: same filter, container stays the source's, aac 192k. Named `volume-<gain>db`.

### Save this frame

- A button on the video well (not a rail operation): saves the frame under the playhead as a lossless png next to the source, named `<clip>-frame-<timecode>.png`.
- Mechanics: `-ss <t> -i in -frames:v 1 out.png`. It is a real run through the queue, so it shows up in the scrollback and downloads like anything else.

## The multi-input model

The app stays single-primary. The store keeps `uploadId` and `meta` exactly as they are. Each multi-input operation keeps its own inputs in its `params` entry, mirroring exactly how replace-audio already carries its second file (id, name, path, meta, status): merge and merge-audio hold `clipIds` and the clip metas, add-music holds the music file, watermark holds the image. Those entries are session state and are dropped from localStorage the same way replace-audio's is. A shared Inputs card renders the primary file plus the extras, with add, remove, and reorder controls. Adding a file uploads it through the same `/upload` endpoint and probes it the same way; nothing on the server grows a new route.

- Merge (video) needs 1 to 3 extras, all video.
- Merge audio needs 1 to 11 extras, all audio.
- Add music needs exactly 1 extra, audio.
- Watermark needs exactly 1 extra, an image.

The Inputs card's hidden picker sets `accept="image/*"` for watermark only; the server's upload accepts any file and ffprobe reads images, so nothing server-side changes. Availability reflects the rules above, with the existing "use that instead" pointer where a refusal has a sibling operation.

## Scope guards

- One transition kind (crossfade), one global duration per merge.
- No per-clip trimming, no timeline, no previews of the transition.
- Merge caps at 4 video clips and 12 audio files.
- No ducking in add music: two volumes are the whole feature.
- No timelapse from photos, no silence removal in this batch (the two consciously skipped, both documented in the spec's idea section).

## Testing

- Every builder is snapshot-tested in shared, with special cases: crossfade offset arithmetic, the no-audio splice, single extra file, the 0-fade hard cut, and refusal-to-run states.
- E2e: merge two fixture clips with a 0.5s fade and save the result; merge two tone files; add music to a clip; watermark a clip with a tiny committed png fixture; fade, loop, volume runs; Save this frame writes a png. Command bar assertions check the real filter graph text for merge and add music.
- `npm run verify` stays the gate, contrast included.

## Files touched

```
shared/src/operations.ts        seven new kinds, the union, descriptors
shared/src/build-operations.ts  buildMerge, buildMergeAudio, buildAddMusic,
                                buildWatermark, buildFade, buildLoop, buildVolume,
                                the offset math, the codec map reuse
shared/src/output-name.ts       the new suffixes
shared/src/availability.ts      the new rules and the cross-pointers
shared/src/*.test.ts            snapshots for each builder
server/src/routes/run.ts        resolves the extra ids into io.secondaryInputs
client/src/store/use-scrub-store.ts   extraFiles, add/remove/reorder/clear
client/src/lib/use-upload.ts    upload an extra file
client/src/components/InputsCard.tsx   the shared multi-input list UI
client/src/components/OperationControls.tsx   the new panels wired in
client/src/routes/OperationPanel.tsx          availability wording
client/src/components/MediaWell.tsx           Save this frame button
client/src/lib/api.ts           frameRun helper if needed
e2e/flows.spec.ts               one describe per op plus the frame button
e2e/fixtures/                   a second clip, a small png
```

No changes to the queue, SSE, or job machinery: a merge is one run like any other, which is the whole point of the existing architecture.
