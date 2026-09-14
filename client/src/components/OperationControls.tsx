import type { AudioFormat, OperationKind, ProbeResult, VideoContainer } from '@scrub/shared';

import { Choice, Note, NumberField, Panel, Readout, Row } from '@/components/controls/Field';
import { Filmstrip } from '@/components/Filmstrip';
import { TrimControls } from '@/components/TrimControls';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * The controls for whichever operation is selected.
 *
 * Every panel pairs its settings with a readout taken from the loaded file, so
 * "what will this do to my file" is answered before anything runs. ffmpeg's
 * settings are almost all misread on their face: CRF is not a file size, a
 * preset is not quality, and converting is sometimes instant and sometimes
 * minutes of re-encoding. The command bar shows the flags. These say what they
 * cost.
 */
export function OperationControls({
  kind,
  id,
  meta,
}: {
  readonly kind: OperationKind;
  readonly id: string;
  readonly meta: ProbeResult;
}) {
  switch (kind) {
    case 'trim':
      return <TrimControls id={id} meta={meta} />;
    case 'compress':
      return <Compress meta={meta} />;
    case 'convert':
      return <Convert meta={meta} />;
    case 'resize':
      return <Resize meta={meta} />;
    case 'gif':
      return <Gif id={id} meta={meta} />;
    case 'extract-audio':
      return <ExtractAudio meta={meta} />;
    case 'mute':
      return <Mute meta={meta} />;
    case 'replace-audio':
      return <ReplaceAudio />;
    case 'audio-convert':
      return <AudioConvert meta={meta} />;
    case 'audio-trim':
      return <TrimControls id={id} meta={meta} audioOnly />;
    case 'loudness':
      return <Loudness meta={meta} />;
  }
}

/* ── Video ──────────────────────────────────────────────────────────────── */

function Compress({ meta }: { readonly meta: ProbeResult }) {
  const { crf, preset } = useScrubStore((state) => state.params.compress);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Quality"
          value={crf}
          min={16}
          max={34}
          suffix="CRF"
          onChange={(value) => {
            setParams('compress', { crf: Math.round(value) });
          }}
          ticks={[
            { at: 18, label: 'near-lossless' },
            { at: 23, label: 'default' },
            { at: 28, label: 'soft' },
          ]}
          meaning={
            crf <= 20
              ? 'Hard to tell from the original, and not much smaller than it.'
              : crf >= 28
                ? 'Visibly softer, most of all where the picture moves a lot.'
                : 'A good balance for something you are about to send somewhere.'
          }
        />
      </Row>

      <Choice
        legend="Encoding speed"
        name="compress-preset"
        columns={3}
        value={preset}
        options={[
          { value: 'veryfast', label: 'Very fast', detail: 'Quickest, and the largest file.' },
          { value: 'medium', label: 'Medium', detail: 'The usual balance of time against size.' },
          { value: 'veryslow', label: 'Very slow', detail: 'Smallest file, and it takes a while.' },
        ]}
        onChange={(value) => {
          setParams('compress', { preset: value });
        }}
      />

      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video
              ? `${String(meta.video.width)} × ${String(meta.video.height)}`
              : 'none',
            to: meta.video ? `${String(meta.video.width)} × ${String(meta.video.height)}` : 'none',
          },
          {
            label: 'File size',
            from: formatBytes(meta.sizeBytes),
            to: 'depends on the picture',
            estimated: true,
          },
        ]}
      />

      <Note>
        This asks for a quality level, not a size, so the result is however many bytes that quality
        happens to take. A still clip comes out far smaller than a busy one at the same setting,
        which is why Scrub will not pretend to know the number in advance. Speed changes how long
        the encoder spends hunting for a smaller file at the same quality. It does not change the
        quality itself.
      </Note>
    </Panel>
  );
}

/** Video codecs each container can hold without re-encoding. */
const CONTAINER_ACCEPTS: Record<VideoContainer, readonly string[]> = {
  mp4: ['h264', 'hevc', 'mpeg4', 'av1'],
  webm: ['vp8', 'vp9', 'av1'],
  mkv: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores'],
  mov: ['h264', 'hevc', 'prores', 'mpeg4'],
};

const CONTAINER_TARGET: Record<VideoContainer, { readonly video: string; readonly audio: string }> =
  {
    mp4: { video: 'h264', audio: 'aac' },
    webm: { video: 'vp9', audio: 'opus' },
    mkv: { video: 'h264', audio: 'aac' },
    mov: { video: 'h264', audio: 'aac' },
  };

function Convert({ meta }: { readonly meta: ProbeResult }) {
  const { container } = useScrubStore((state) => state.params.convert);
  const setParams = useScrubStore((state) => state.setParams);

  const codec = meta.video?.codec.toLowerCase() ?? '';
  const free = codec !== '' && CONTAINER_ACCEPTS[container].includes(codec);
  const target = CONTAINER_TARGET[container];

  return (
    <Panel>
      <Choice
        legend="Container"
        name="convert-container"
        value={container}
        options={[
          {
            value: 'mp4',
            label: 'MP4',
            detail: 'Plays everywhere. The safe choice for sending to someone.',
          },
          {
            value: 'webm',
            label: 'WebM',
            detail: 'Smaller at the same quality, but always re-encodes from h264.',
          },
          {
            value: 'mkv',
            label: 'MKV',
            detail: 'Holds almost any codec, so it is usually an instant rewrap.',
          },
          { value: 'mov', label: 'MOV', detail: 'What editing software tends to expect.' },
        ]}
        onChange={(value) => {
          setParams('convert', { container: value });
        }}
      />

      <Readout
        lines={[
          { label: 'Video', from: codec || 'none', to: free ? `${codec}, copied` : target.video },
          {
            label: 'Audio',
            from: meta.audio?.codec ?? 'none',
            to: meta.audio === null ? 'none' : free ? `${meta.audio.codec}, copied` : target.audio,
          },
          { label: 'How long it takes', from: '', to: free ? 'almost no time' : 'a real encode' },
        ]}
      />

      <Note>
        {free
          ? `${container.toUpperCase()} can hold ${codec} exactly as it is, so Scrub rewraps the streams instead of re-encoding them. Nothing is decoded, nothing is lost, and it finishes about as fast as copying the file.`
          : `${container.toUpperCase()} cannot hold ${codec || 'this codec'}, so the video has to be decoded and encoded again. That takes real time and costs a generation of quality, because every lossy re-encode discards a little more.`}
      </Note>
    </Panel>
  );
}

function Resize({ meta }: { readonly meta: ProbeResult }) {
  const { width } = useScrubStore((state) => state.params.resize);
  const setParams = useScrubStore((state) => state.setParams);

  const source = meta.video;
  const height =
    source && source.width > 0 ? Math.round((width * source.height) / source.width / 2) * 2 : null;
  const pixelRatio =
    source && height !== null ? (width * height) / (source.width * source.height) : null;

  const presets = source ? [1440, 1080, 720, 480].filter((h) => h < source.height).slice(0, 3) : [];

  return (
    <Panel>
      <Row>
        <NumberField
          label="Width"
          value={width}
          min={160}
          max={Math.max(source?.width ?? 1920, 1920)}
          step={2}
          suffix="px"
          onChange={(value) => {
            // libx264 refuses odd dimensions, so the control never offers one.
            setParams('resize', { width: Math.max(2, Math.round(value / 2) * 2) });
          }}
          meaning={
            source && width > source.width
              ? 'Bigger than the original. This cannot add detail that was never recorded.'
              : pixelRatio !== null
                ? `About ${String(Math.round(pixelRatio * 100))} percent of the original pixels.`
                : undefined
          }
        />
      </Row>

      {source !== null && presets.length > 0 && (
        <div>
          <p className="text-micro text-muted mb-2 tracking-wide">Common sizes</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((h) => {
              const w = Math.round((h * source.width) / source.height / 2) * 2;
              const active = w === width;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setParams('resize', { width: w });
                  }}
                  className={cnPreset(active)}
                >
                  {h}p
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Readout
        lines={[
          {
            label: 'Picture',
            from: source ? `${String(source.width)} × ${String(source.height)}` : 'none',
            to: source && height !== null ? `${String(width)} × ${String(height)}` : 'unchanged',
          },
          { label: 'Audio', from: meta.audio?.codec ?? 'none', to: 'copied, untouched' },
        ]}
      />

      <Note>
        The height follows the original shape and is rounded to an even number, which the encoder
        requires. Only the picture is re-encoded. The sound is copied across exactly as it was.
      </Note>
    </Panel>
  );
}

function cnPreset(active: boolean): string {
  return [
    'text-label rounded-button border px-3 py-1.5 font-mono tabular-nums transition-colors duration-100',
    active
      ? 'border-accent text-accent bg-accent/[0.06]'
      : 'border-line text-ink hover:border-line-strong',
  ].join(' ');
}

function Gif({ id, meta }: { readonly id: string; readonly meta: ProbeResult }) {
  const { fps, width, useRange } = useScrubStore((state) => state.params.gif);
  const trim = useScrubStore((state) => state.trim);
  const setTrim = useScrubStore((state) => state.setTrim);
  const setParams = useScrubStore((state) => state.setParams);

  const seconds = useRange ? trim.endSec - trim.startSec : meta.durationSec;
  const source = meta.video;
  const height =
    source && source.width > 0 ? Math.round((width * source.height) / source.width) : 0;
  const frames = Math.max(1, Math.round(fps * seconds));

  /**
   * Bits per pixel, measured from GIFs Scrub actually produced rather than
   * guessed: 0.92 and 0.69 on two real encodes, so 0.8 sits between them.
   *
   * The number matters more than it looks. This estimate exists to warn people
   * that a few seconds of video becomes an enormous GIF, and a figure that is
   * too low does the opposite of its job. Real content varies either side of
   * this, which is why the readout marks the value as approximate.
   */
  const estimateMb = (width * height * frames * 0.8) / 8 / 1_000_000;

  return (
    <Panel>
      {source !== null && (
        <div>
          <p className="text-micro text-muted mb-2 tracking-wide">
            Drag the handles to choose which part becomes the GIF
          </p>
          <Filmstrip
            id={id}
            durationSec={meta.durationSec}
            startSec={trim.startSec}
            endSec={trim.endSec}
            onChange={setTrim}
            hasAudio={meta.audio !== null}
          />
        </div>
      )}

      <Choice
        legend="How much of the clip"
        name="gif-range"
        value={useRange ? 'range' : 'all'}
        options={[
          {
            value: 'range',
            label: 'The selected range',
            detail: `${(trim.endSec - trim.startSec).toFixed(1)} seconds, set on the strip above.`,
          },
          {
            value: 'all',
            label: 'The whole clip',
            detail: `All ${meta.durationSec.toFixed(1)} seconds of it.`,
          },
        ]}
        onChange={(value) => {
          setParams('gif', { useRange: value === 'range' });
        }}
      />

      <Row>
        <NumberField
          label="Frame rate"
          value={fps}
          min={5}
          max={30}
          suffix="fps"
          onChange={(value) => {
            setParams('gif', { fps: Math.round(value) });
          }}
          ticks={[
            { at: 8, label: 'choppy' },
            { at: 15, label: 'smooth' },
            { at: 25, label: 'very smooth' },
          ]}
          meaning={`${String(frames)} frames in total, and every one is stored whole.`}
        />
        <NumberField
          label="Width"
          value={width}
          min={120}
          max={960}
          step={2}
          suffix="px"
          onChange={(value) => {
            setParams('gif', { width: Math.max(2, Math.round(value / 2) * 2) });
          }}
          ticks={[
            { at: 240, label: 'small' },
            { at: 480, label: 'typical' },
            { at: 800, label: 'large' },
          ]}
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Picture',
            from: source ? `${String(source.width)} × ${String(source.height)}` : 'none',
            to: `${String(width)} × ${String(height)}`,
          },
          {
            label: 'Frames',
            from: `${String(Math.round((source?.fps ?? 30) * meta.durationSec))} at ${String(source?.fps ?? 30)} fps`,
            to: `${String(frames)} at ${String(fps)} fps`,
          },
          {
            label: 'Size',
            from: formatBytes(meta.sizeBytes),
            to: estimateMb < 1 ? 'under 1 MB' : `${String(Math.round(estimateMb))} MB`,
            estimated: true,
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'none, GIF has no audio' },
        ]}
      />

      <Note>
        GIF stores every frame whole, so length, width and frame rate each multiply the size
        directly. Scrub builds a colour palette from your actual frames and then applies it, which
        is why this comes out better than the usual result. The size above is a rough guess rather
        than a promise.
      </Note>
    </Panel>
  );
}

function Mute({ meta }: { readonly meta: ProbeResult }) {
  return (
    <Panel>
      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: `${meta.video?.codec ?? 'none'}, copied`,
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'removed' },
        ]}
      />
      <Note>
        {meta.audio === null
          ? 'This file already has no audio track, so there is nothing here to remove.'
          : 'The audio track is dropped and the picture is copied across bit for bit. Nothing is re-encoded, so this finishes almost instantly and the video stays identical to the original.'}
      </Note>
    </Panel>
  );
}

function ReplaceAudio() {
  return (
    <Panel>
      <Note>
        Replacing audio needs a second file, and Scrub can only hold one at a time so far. The
        command bar below is already set up for it: it takes the picture from the first input and
        the sound from the second. Point that second input at the file you want, then press Run.
      </Note>
    </Panel>
  );
}

/* ── Audio ──────────────────────────────────────────────────────────────── */

const AUDIO_OPTIONS: readonly {
  readonly value: AudioFormat;
  readonly label: string;
  readonly detail: string;
}[] = [
  { value: 'mp3', label: 'MP3', detail: 'Opens anywhere, including old hardware.' },
  { value: 'aac', label: 'AAC', detail: 'Better than MP3 at the same size. Saved as .m4a.' },
  { value: 'opus', label: 'Opus', detail: 'The best of the three at small sizes.' },
  { value: 'wav', label: 'WAV', detail: 'Uncompressed. Large, and loses nothing.' },
  { value: 'flac', label: 'FLAC', detail: 'Compressed but lossless. Half the size of WAV.' },
];

/** Whether the chosen format means copying the existing track or re-encoding it. */
function audioFate(source: string | null, format: AudioFormat): string {
  if (source === null) return 'none';
  const copied = source === format || (format === 'wav' && source.startsWith('pcm'));
  return copied ? `${source}, copied` : format;
}

function ExtractAudio({ meta }: { readonly meta: ProbeResult }) {
  const { format } = useScrubStore((state) => state.params.extractAudio);
  const setParams = useScrubStore((state) => state.setParams);
  const source = meta.audio?.codec.toLowerCase() ?? null;
  const copies = audioFate(source, format).includes('copied');

  return (
    <Panel>
      <Choice
        legend="Format"
        name="extract-format"
        columns={3}
        value={format}
        options={AUDIO_OPTIONS}
        onChange={(value) => {
          setParams('extractAudio', { format: value });
        }}
      />

      <Readout
        lines={[
          { label: 'Picture', from: meta.video?.codec ?? 'none', to: 'removed' },
          { label: 'Sound', from: source ?? 'none', to: audioFate(source, format) },
          {
            label: 'Channels',
            from: describeChannels(meta.audio?.channels ?? 0),
            to: describeChannels(meta.audio?.channels ?? 0),
          },
        ]}
      />

      <Note>
        {copies
          ? `The track is already ${source ?? ''}, so Scrub lifts it out untouched. Nothing is decoded and nothing is lost.`
          : `The track is ${source ?? 'unknown'}, so it has to be re-encoded as ${format.toUpperCase()}. Going from one lossy format to another always costs a little quality. Picking ${source ?? 'the source format'} above avoids that entirely.`}
      </Note>
    </Panel>
  );
}

function AudioConvert({ meta }: { readonly meta: ProbeResult }) {
  const { format, bitrateKbps } = useScrubStore((state) => state.params.audioConvert);
  const setParams = useScrubStore((state) => state.setParams);
  const lossless = format === 'wav' || format === 'flac';
  const source = meta.audio?.codec.toLowerCase() ?? null;

  return (
    <Panel>
      <Choice
        legend="Format"
        name="audio-format"
        columns={3}
        value={format}
        options={AUDIO_OPTIONS}
        onChange={(value) => {
          setParams('audioConvert', { format: value });
        }}
      />

      {!lossless && (
        <Row>
          <NumberField
            label="Bitrate"
            value={bitrateKbps ?? 192}
            min={64}
            max={320}
            step={32}
            suffix="kbps"
            onChange={(value) => {
              setParams('audioConvert', { bitrateKbps: Math.round(value) });
            }}
            ticks={[
              { at: 96, label: 'audible loss' },
              { at: 192, label: 'good' },
              { at: 288, label: 'transparent' },
            ]}
            meaning={
              (bitrateKbps ?? 192) <= 96
                ? 'Small files, and most people can hear the difference.'
                : 'Hard to tell from the original for most listeners on most equipment.'
            }
          />
        </Row>
      )}

      <Readout
        lines={[
          { label: 'Sound', from: source ?? 'none', to: audioFate(source, format) },
          {
            label: 'Sample rate',
            from: formatRate(meta.audio?.sampleRate ?? null),
            to: formatRate(meta.audio?.sampleRate ?? null),
          },
          {
            label: 'Bitrate',
            from:
              meta.bitrate === null ? 'unknown' : `${String(Math.round(meta.bitrate / 1000))} kbps`,
            to: lossless ? 'not applicable' : `${String(bitrateKbps ?? 192)} kbps`,
          },
        ]}
      />

      <Note>
        {lossless
          ? 'Lossless formats discard nothing, so there is no bitrate to choose. The size follows from the audio itself.'
          : 'Raising the bitrate above the original cannot bring back detail the first encode already threw away. It only makes the file bigger.'}
      </Note>
    </Panel>
  );
}

function Loudness({ meta }: { readonly meta: ProbeResult }) {
  const { targetI, targetTP, targetLRA } = useScrubStore((state) => state.params.loudness);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Loudness"
          value={targetI}
          min={-30}
          max={-9}
          step={0.5}
          suffix="LUFS"
          onChange={(value) => {
            setParams('loudness', { targetI: value });
          }}
          ticks={[
            { at: -23, label: 'broadcast' },
            { at: -16, label: 'streaming' },
            { at: -11, label: 'loud' },
          ]}
          meaning={
            targetI === -16
              ? 'What most streaming services normalise to anyway.'
              : targetI < -20
                ? 'Quiet, with plenty of headroom. Broadcast territory.'
                : 'Louder than most platforms keep. They may turn it back down.'
          }
        />
      </Row>

      <Row>
        <NumberField
          label="Peak ceiling"
          value={targetTP}
          min={-6}
          max={-0.5}
          step={0.1}
          suffix="dBTP"
          onChange={(value) => {
            setParams('loudness', { targetTP: Math.round(value * 10) / 10 });
          }}
          meaning="The loudest any single moment may reach, which is what stops it distorting."
        />
        <NumberField
          label="Dynamic range"
          value={targetLRA}
          min={1}
          max={20}
          suffix="LU"
          onChange={(value) => {
            setParams('loudness', { targetLRA: Math.round(value) });
          }}
          meaning="How much distance to keep between the quiet parts and the loud ones."
        />
      </Row>

      <Readout
        lines={[
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: `${String(targetI)} LUFS` },
          { label: 'Picture', from: meta.video?.codec ?? 'none', to: 'copied, untouched' },
          { label: 'Passes', from: '', to: 'measure, then correct' },
        ]}
      />

      <Note>
        Scrub plays the file through once to measure it, then applies a single calculated
        adjustment. That is what makes this a clean correction rather than a compressor guessing as
        it goes, which is what one pass would be, and which pumps audibly. If the file has video, it
        is copied across untouched.
      </Note>
    </Panel>
  );
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

function describeChannels(count: number): string {
  if (count === 0) return 'none';
  if (count === 1) return 'mono';
  if (count === 2) return 'stereo';
  return `${String(count)} channels`;
}

function formatRate(hz: number | null): string {
  return hz === null ? 'unknown' : `${String(Math.round(hz / 100) / 10)} kHz`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
