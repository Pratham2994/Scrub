import type { AudioFormat, OperationKind, ProbeResult, VideoContainer } from '@scrub/shared';

import { Choice, Hint, NumberField, Panel, Row, Select } from '@/components/controls/Field';
import { Filmstrip } from '@/components/Filmstrip';
import { TrimControls } from '@/components/TrimControls';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * The controls for whichever operation is selected.
 *
 * Every panel says what its settings cost, because ffmpeg's are almost all
 * misread: CRF is not a file size, a preset is not quality, a GIF's width
 * decides most of its weight, and "convert" is sometimes free and sometimes
 * minutes of re-encoding. The command bar shows the flags; these say why.
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
      return <Loudness />;
  }
}

const AUDIO_FORMATS: readonly { readonly value: AudioFormat; readonly label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC (m4a)' },
  { value: 'opus', label: 'Opus' },
  { value: 'wav', label: 'WAV (uncompressed)' },
  { value: 'flac', label: 'FLAC (lossless)' },
];

function Compress({ meta }: { readonly meta: ProbeResult }) {
  const { crf, preset } = useScrubStore((state) => state.params.compress);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Quality (CRF)"
          value={crf}
          min={14}
          max={40}
          onChange={(value) => {
            setParams('compress', { crf: Math.round(value) });
          }}
          hint={crf <= 20 ? 'Near-lossless, large' : crf >= 30 ? 'Visibly soft' : 'A good default'}
        />
        <Select
          label="Encoding speed"
          value={preset}
          options={[
            { value: 'veryfast', label: 'Very fast' },
            { value: 'fast', label: 'Fast' },
            { value: 'medium', label: 'Medium' },
            { value: 'slow', label: 'Slow' },
            { value: 'veryslow', label: 'Very slow' },
          ]}
          onChange={(value) => {
            setParams('compress', { preset: value });
          }}
          hint="Slower spends longer finding a smaller file at the same quality."
        />
      </Row>
      <Hint>
        Lower CRF means better and bigger. It asks for a quality level rather than a file size, so
        the result is however many bytes that takes — a still clip will come out far smaller than a
        busy one. The source is {formatBytes(meta.sizeBytes)}.
      </Hint>
    </Panel>
  );
}

/** Containers that can hold the source's video codec without re-encoding. */
const CONTAINER_ACCEPTS: Record<VideoContainer, readonly string[]> = {
  mp4: ['h264', 'hevc', 'mpeg4', 'av1'],
  webm: ['vp8', 'vp9', 'av1'],
  mkv: ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores'],
  mov: ['h264', 'hevc', 'prores', 'mpeg4'],
};

function Convert({ meta }: { readonly meta: ProbeResult }) {
  const { container } = useScrubStore((state) => state.params.convert);
  const setParams = useScrubStore((state) => state.setParams);

  const codec = meta.video?.codec.toLowerCase() ?? '';
  const free = CONTAINER_ACCEPTS[container].includes(codec);

  return (
    <Panel>
      <Select
        label="Container"
        value={container}
        options={[
          { value: 'mp4', label: 'MP4' },
          { value: 'webm', label: 'WebM' },
          { value: 'mkv', label: 'MKV' },
          { value: 'mov', label: 'MOV' },
        ]}
        onChange={(value) => {
          setParams('convert', { container: value });
        }}
      />
      <Hint>
        {free
          ? `${container.toUpperCase()} can hold ${codec || 'this'} as it is, so this is a rewrap — no re-encoding, no quality lost, and it finishes almost instantly.`
          : `${container.toUpperCase()} cannot hold ${codec || 'this codec'}, so the video has to be re-encoded. That takes real time and costs a generation of quality.`}
      </Hint>
    </Panel>
  );
}

function Resize({ meta }: { readonly meta: ProbeResult }) {
  const { width } = useScrubStore((state) => state.params.resize);
  const setParams = useScrubStore((state) => state.setParams);

  const source = meta.video;
  const height =
    source && source.width > 0 ? Math.round((width * source.height) / source.width / 2) * 2 : null;

  return (
    <Panel>
      <Row>
        <NumberField
          label="Width"
          value={width}
          min={160}
          max={Math.max(source?.width ?? 3840, 3840)}
          step={2}
          suffix="px"
          onChange={(value) => {
            // libx264 refuses odd dimensions, so the control cannot offer one.
            setParams('resize', { width: Math.max(2, Math.round(value / 2) * 2) });
          }}
        />
        {source && (
          <div>
            <p className="text-label text-muted mb-1">Result</p>
            <p className="text-body text-ink font-mono tabular-nums">
              {width} × {height ?? '?'}
            </p>
            <p className="text-micro text-muted mt-1">
              from {source.width} × {source.height}
            </p>
          </div>
        )}
      </Row>
      <Hint>
        The height follows the source's shape and is rounded to an even number, which the encoder
        requires. Enlarging past the original will not add detail that was never recorded.
      </Hint>
    </Panel>
  );
}

function Gif({ id, meta }: { readonly id: string; readonly meta: ProbeResult }) {
  const { fps, width, useRange } = useScrubStore((state) => state.params.gif);
  const trim = useScrubStore((state) => state.trim);
  const setTrim = useScrubStore((state) => state.setTrim);
  const setParams = useScrubStore((state) => state.setParams);

  const seconds = useRange ? trim.endSec - trim.startSec : meta.durationSec;
  // Rough, and labelled as rough. The point is the order of magnitude: people are
  // routinely surprised that a few seconds of video is a twenty-megabyte GIF.
  const estimateMb = (width * (width * 0.5625) * fps * seconds * 0.12) / 8 / 1_000_000;

  return (
    <Panel>
      {meta.video !== null && (
        <Filmstrip
          id={id}
          durationSec={meta.durationSec}
          startSec={trim.startSec}
          endSec={trim.endSec}
          onChange={setTrim}
        />
      )}
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
          hint={fps < 10 ? 'Choppy, but small' : fps > 20 ? 'Smooth, and heavy' : 'Smooth enough'}
        />
        <NumberField
          label="Width"
          value={width}
          min={120}
          max={1280}
          step={2}
          suffix="px"
          onChange={(value) => {
            setParams('gif', { width: Math.max(2, Math.round(value / 2) * 2) });
          }}
        />
      </Row>
      <Choice
        name="gif-range"
        legend="How much"
        value={useRange ? 'range' : 'all'}
        options={[
          {
            value: 'range',
            title: 'The selected range',
            detail: `${seconds.toFixed(1)}s from the strip above.`,
          },
          {
            value: 'all',
            title: 'The whole clip',
            detail: `All ${meta.durationSec.toFixed(1)}s.`,
          },
        ]}
        onChange={(value) => {
          setParams('gif', { useRange: value === 'range' });
        }}
      />
      <Hint>
        Roughly {estimateMb < 1 ? '<1' : estimateMb.toFixed(0)} MB — a very rough guess, but GIF has
        no real compression, so length, width and frame rate each multiply the size. Scrub builds a
        palette from the actual frames first, which is why this looks better than most.
      </Hint>
    </Panel>
  );
}

function ExtractAudio({ meta }: { readonly meta: ProbeResult }) {
  const { format } = useScrubStore((state) => state.params.extractAudio);
  const setParams = useScrubStore((state) => state.setParams);
  const source = meta.audio?.codec.toLowerCase() ?? null;
  const copies = (format === 'aac' && source === 'aac') || format === source;

  return (
    <Panel>
      <Select
        label="Format"
        value={format}
        options={AUDIO_FORMATS}
        onChange={(value) => {
          setParams('extractAudio', { format: value });
        }}
      />
      <Hint>
        {copies
          ? `The track is already ${source}, so it is copied out untouched — nothing is re-encoded and nothing is lost.`
          : `The track is ${source ?? 'unknown'}, so it will be re-encoded to ${format.toUpperCase()}. Converting between lossy formats always costs a little quality; pick the source's own format to avoid that.`}
      </Hint>
    </Panel>
  );
}

function Mute({ meta }: { readonly meta: ProbeResult }) {
  return (
    <Panel>
      <Hint>
        {meta.audio === null
          ? 'This file already has no audio track, so there is nothing to remove.'
          : 'Removes the audio track and copies the video across untouched. Nothing is re-encoded, so it finishes almost instantly and the picture is bit-for-bit identical.'}
      </Hint>
    </Panel>
  );
}

function ReplaceAudio() {
  const { audioName } = useScrubStore((state) => state.params.replaceAudio);

  return (
    <Panel>
      <Hint>
        {audioName === null
          ? 'Replace audio needs a second file, and Scrub can only hold one at a time yet. For now, use the command bar: it is already set up to map the video from one input and the audio from another.'
          : `Using ${audioName}.`}
      </Hint>
    </Panel>
  );
}

function AudioConvert({ meta }: { readonly meta: ProbeResult }) {
  const { format, bitrateKbps } = useScrubStore((state) => state.params.audioConvert);
  const setParams = useScrubStore((state) => state.setParams);
  const lossless = format === 'wav' || format === 'flac';

  return (
    <Panel>
      <Row>
        <Select
          label="Format"
          value={format}
          options={AUDIO_FORMATS}
          onChange={(value) => {
            setParams('audioConvert', { format: value });
          }}
        />
        {!lossless && (
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
            hint={
              (bitrateKbps ?? 192) <= 96
                ? 'Small, and you can hear it'
                : 'Transparent for most ears'
            }
          />
        )}
      </Row>
      <Hint>
        {lossless
          ? 'Lossless formats throw nothing away, so there is no bitrate to set — the size follows from the audio itself.'
          : `The source is ${meta.audio?.codec ?? 'unknown'} at ${formatRate(meta.audio?.sampleRate ?? null)}. Raising the bitrate above the source cannot recover detail the original already discarded.`}
      </Hint>
    </Panel>
  );
}

function Loudness() {
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
          hint={targetI === -16 ? 'The streaming default' : 'Non-standard target'}
        />
        <NumberField
          label="Peak ceiling"
          value={targetTP}
          min={-6}
          max={-0.1}
          step={0.1}
          suffix="dBTP"
          onChange={(value) => {
            setParams('loudness', { targetTP: Math.round(value * 10) / 10 });
          }}
        />
        <NumberField
          label="Dynamic range"
          value={targetLRA}
          min={1}
          max={20}
          step={1}
          suffix="LU"
          onChange={(value) => {
            setParams('loudness', { targetLRA: Math.round(value) });
          }}
        />
      </Row>
      <Hint>
        Two passes: the first measures the file, the second applies one calculated gain. That is
        what makes it a linear correction rather than a compressor working blind, which is what
        single-pass normalisers do — and they pump audibly. The video is copied across untouched.
      </Hint>
    </Panel>
  );
}

/** "48 kHz", or an honest blank when ffprobe could not tell. */
function formatRate(hz: number | null): string {
  return hz === null ? 'an unknown rate' : `${String(Math.round(hz / 100) / 10)} kHz`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
