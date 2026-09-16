import {
  formatTimecode as formatSeconds,
  type ProbeResult,
  type WatermarkPosition,
} from '@scrub/shared';

import { InputsCard } from '@/components/InputsCard';
import { Choice, Note, NumberField, Panel, Readout, Row } from '@/components/controls/Field';
import { ApiError, uploadFile } from '@/lib/api';
import { useScrubStore } from '@/store/use-scrub-store';

/**
 * The merge suite panels.
 *
 * Kept out of OperationControls.tsx purely for size: these ten panels follow the
 * same Field vocabulary as everything else, and the multi-input four share the
 * InputsCard and the same upload pattern replace-audio established.
 */

export function Merge({ meta }: { readonly meta: ProbeResult }) {
  const merge = useScrubStore((state) => state.params.merge);
  const setParams = useScrubStore((state) => state.setParams);

  const add = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('merge', { status: 'loading', error: null });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.video === null) {
          setParams('merge', {
            status: 'failed',
            error: 'That file has no picture. Joining songs is the Merge in the Audio group.',
          });
          return;
        }
        const clips = [...merge.clips];
        clips.push({
          id: result.id,
          name: result.meta.displayName,
          path: result.meta.path,
          meta: result.meta,
        });
        setParams('merge', {
          status: 'idle',
          error: null,
          clips,
          clipIds: clips.map((clip) => clip.id),
        });
      })
      .catch((error: unknown) => {
        setParams('merge', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
        });
      });
  };

  const remove = (id: string): void => {
    const clips = merge.clips.filter((clip) => clip.id !== id);
    setParams('merge', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const move = (id: string, direction: -1 | 1): void => {
    const index = merge.clips.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= merge.clips.length) return;
    const clips = [...merge.clips];
    const [moved] = clips.splice(index, 1);
    if (!moved) return;
    clips.splice(target, 0, moved);
    setParams('merge', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const total =
    merge.clips.reduce((sum, clip) => sum + clip.meta.durationSec, meta.durationSec) -
    merge.crossfadeSec * merge.clips.length;

  return (
    <Panel>
      <InputsCard
        legend="Clips to join, in order"
        empty="Drop or click to add a clip. The loaded file goes first."
        accept="video/*"
        items={merge.clips.map((clip) => ({ id: clip.id, name: clip.name }))}
        max={3}
        loading={merge.status === 'loading' ? '' : null}
        error={merge.error}
        onAdd={add}
        onRemove={remove}
        onMove={move}
      />

      <Row>
        <NumberField
          label="Crossfade"
          value={merge.crossfadeSec}
          min={0}
          max={2}
          step={0.1}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { crossfadeSec: Math.round(value * 10) / 10 });
          }}
          ticks={[
            { at: 0, label: 'hard cut' },
            { at: 0.5, label: 'gentle' },
            { at: 2, label: 'long' },
          ]}
          meaning={
            merge.crossfadeSec === 0
              ? 'Each clip starts the instant the last one ends.'
              : 'Each clip fades into the next over this long.'
          }
        />
        <NumberField
          label="Quality"
          value={merge.crf}
          min={16}
          max={30}
          suffix="CRF"
          onChange={(value) => {
            setParams('merge', { crf: Math.round(value) });
          }}
          meaning="Lower keeps more detail. Joining clips always re-encodes the picture."
        />
      </Row>

      <Row>
        <NumberField
          label="Fade in"
          value={merge.fadeInSec}
          min={0}
          max={5}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { fadeInSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined result in from black and silence. 0 means none."
        />
        <NumberField
          label="Fade out"
          value={merge.fadeOutSec}
          min={0}
          max={5}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('merge', { fadeOutSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined result out. 0 means none."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Clips',
            from: `${String(merge.clips.length + 1)} of up to 4`,
            to: merge.clips.length === 0 ? 'add at least one more' : 'joined',
          },
          { label: 'Length', from: formatSeconds(meta.durationSec), to: formatSeconds(total) },
          {
            label: 'Picture',
            from: 'several sizes',
            to: `${String(meta.video?.width ?? 0)} × ${String(meta.video?.height ?? 0)}, matched to the first clip`,
          },
        ]}
      />

      <Note>
        Every clip is matched to the first one: same size, same frame rate, same audio rate. The
        picture is re-encoded at your quality setting, which a join always needs, and the sound is
        crossfaded to match.
      </Note>
    </Panel>
  );
}

export function MergeAudio({ meta }: { readonly meta: ProbeResult }) {
  const mergeAudio = useScrubStore((state) => state.params.mergeAudio);
  const setParams = useScrubStore((state) => state.setParams);

  const add = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('mergeAudio', { status: 'loading', error: null });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.video !== null) {
          setParams('mergeAudio', {
            status: 'failed',
            error: 'That file has a picture. Joining clips is the Merge in the Video group.',
          });
          return;
        }
        const clips = [...mergeAudio.clips];
        clips.push({
          id: result.id,
          name: result.meta.displayName,
          path: result.meta.path,
          meta: result.meta,
        });
        setParams('mergeAudio', {
          status: 'idle',
          error: null,
          clips,
          clipIds: clips.map((clip) => clip.id),
        });
      })
      .catch((error: unknown) => {
        setParams('mergeAudio', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
        });
      });
  };

  const remove = (id: string): void => {
    const clips = mergeAudio.clips.filter((clip) => clip.id !== id);
    setParams('mergeAudio', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const move = (id: string, direction: -1 | 1): void => {
    const index = mergeAudio.clips.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= mergeAudio.clips.length) return;
    const clips = [...mergeAudio.clips];
    const [moved] = clips.splice(index, 1);
    if (!moved) return;
    clips.splice(target, 0, moved);
    setParams('mergeAudio', { clips, clipIds: clips.map((clip) => clip.id) });
  };

  const total =
    mergeAudio.clips.reduce((sum, clip) => sum + clip.meta.durationSec, meta.durationSec) -
    mergeAudio.crossfadeSec * mergeAudio.clips.length;

  return (
    <Panel>
      <InputsCard
        legend="Songs to join, in order"
        empty="Drop or click to add a song. The loaded file goes first."
        accept="audio/*"
        items={mergeAudio.clips.map((clip) => ({ id: clip.id, name: clip.name }))}
        max={11}
        loading={mergeAudio.status === 'loading' ? '' : null}
        error={mergeAudio.error}
        onAdd={add}
        onRemove={remove}
        onMove={move}
      />

      <Row>
        <NumberField
          label="Crossfade"
          value={mergeAudio.crossfadeSec}
          min={0}
          max={10}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('mergeAudio', { crossfadeSec: Math.round(value * 2) / 2 });
          }}
          ticks={[
            { at: 0, label: 'hard cut' },
            { at: 2, label: 'gentle' },
            { at: 6, label: 'long' },
          ]}
          meaning={
            mergeAudio.crossfadeSec === 0
              ? 'Each song starts the instant the last one ends.'
              : 'Each song fades into the next over this long.'
          }
        />
        <NumberField
          label="Bitrate"
          value={mergeAudio.bitrateKbps}
          min={64}
          max={320}
          step={32}
          suffix="kbps"
          onChange={(value) => {
            setParams('mergeAudio', { bitrateKbps: Math.round(value / 32) * 32 });
          }}
          ticks={[
            { at: 128, label: 'fine for speech' },
            { at: 192, label: 'good' },
            { at: 288, label: 'transparent' },
          ]}
          meaning="Joining songs always re-encodes the sound; this sets how much detail survives."
        />
      </Row>

      <Row>
        <NumberField
          label="Fade in"
          value={mergeAudio.fadeInSec}
          min={0}
          max={30}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('mergeAudio', { fadeInSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined mix in from silence. 0 means none."
        />
        <NumberField
          label="Fade out"
          value={mergeAudio.fadeOutSec}
          min={0}
          max={30}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams('mergeAudio', { fadeOutSec: Math.round(value * 2) / 2 });
          }}
          meaning="Fades the joined mix out. 0 means none."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Songs',
            from: `${String(mergeAudio.clips.length + 1)} of up to 12`,
            to: mergeAudio.clips.length === 0 ? 'add at least one more' : 'joined',
          },
          { label: 'Length', from: formatSeconds(meta.durationSec), to: formatSeconds(total) },
          { label: 'Picture', from: 'none', to: 'none, songs only' },
        ]}
      />

      <Note>
        Every file is matched to the first one&apos;s sample rate and crossfaded into the next. The
        result is an m4a with aac sound, saved next to the first file.
      </Note>
    </Panel>
  );
}

export function AddMusic({ meta }: { readonly meta: ProbeResult }) {
  const music = useScrubStore((state) => state.params.addMusic);
  const setParams = useScrubStore((state) => state.setParams);

  const accept = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('addMusic', { status: 'loading', error: null, musicName: file.name });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.audio === null) {
          setParams('addMusic', {
            status: 'failed',
            error: 'That file has no sound in it.',
            musicId: null,
          });
          return;
        }
        setParams('addMusic', {
          status: 'idle',
          error: null,
          musicId: result.id,
          musicName: result.meta.displayName,
          musicPath: result.meta.path,
          musicMeta: result.meta,
        });
      })
      .catch((error: unknown) => {
        setParams('addMusic', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
          musicId: null,
        });
      });
  };

  return (
    <Panel>
      <InputsCard
        legend="The song"
        empty="Drop or click to add a music file."
        accept="audio/*"
        items={
          music.musicId === null || music.musicName === null
            ? []
            : [{ id: music.musicId, name: music.musicName }]
        }
        max={1}
        loading={music.status === 'loading' ? music.musicName : null}
        error={music.error}
        onAdd={accept}
        onRemove={() => {
          setParams('addMusic', {
            musicId: null,
            musicName: null,
            musicPath: null,
            musicMeta: null,
          });
        }}
        onMove={() => undefined}
      />

      <Row>
        <NumberField
          label="Your sound"
          value={music.originalPercent}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => {
            setParams('addMusic', { originalPercent: Math.round(value) });
          }}
          meaning="0 silences the original. The music can take over entirely."
        />
        <NumberField
          label="Music"
          value={music.musicPercent}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => {
            setParams('addMusic', { musicPercent: Math.round(value) });
          }}
          meaning="35 is a background hum; 100 is the song at full strength."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: `${meta.video?.codec ?? 'none'}, copied exactly`,
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'mixed together, as aac' },
          {
            label: 'Length',
            from: formatSeconds(meta.durationSec),
            to: "the video's length, the mix ends with the shorter side",
          },
        ]}
      />

      <Note>
        The picture is copied bit for bit; only the sound is mixed and encoded. The mix runs until
        the shorter of the two sounds ends.
      </Note>
    </Panel>
  );
}

const WATERMARK_POSITIONS: readonly {
  readonly value: WatermarkPosition;
  readonly label: string;
}[] = [
  { value: 'nw', label: 'Top left' },
  { value: 'n', label: 'Top centre' },
  { value: 'ne', label: 'Top right' },
  { value: 'w', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'e', label: 'Right' },
  { value: 'sw', label: 'Bottom left' },
  { value: 's', label: 'Bottom centre' },
  { value: 'se', label: 'Bottom right' },
];

export function Watermark({ meta }: { readonly meta: ProbeResult }) {
  const watermark = useScrubStore((state) => state.params.watermark);
  const setParams = useScrubStore((state) => state.setParams);

  const accept = (file: File | undefined | null): void => {
    if (!file) return;
    setParams('watermark', { status: 'loading', error: null, imageName: file.name });
    uploadFile(file, () => undefined)
      .then((result) => {
        if (result.meta.video === null) {
          setParams('watermark', {
            status: 'failed',
            error: 'That file is not an image Scrub can read.',
            imageId: null,
          });
          return;
        }
        setParams('watermark', {
          status: 'idle',
          error: null,
          imageId: result.id,
          imageName: result.meta.displayName,
          imagePath: result.meta.path,
          imageMeta: result.meta,
        });
      })
      .catch((error: unknown) => {
        setParams('watermark', {
          status: 'failed',
          error: error instanceof ApiError ? error.message : 'That file could not be read.',
          imageId: null,
        });
      });
  };

  return (
    <Panel>
      <InputsCard
        legend="The mark"
        empty="Drop or click to add an image."
        accept="image/*"
        items={
          watermark.imageId === null || watermark.imageName === null
            ? []
            : [{ id: watermark.imageId, name: watermark.imageName }]
        }
        max={1}
        loading={watermark.status === 'loading' ? watermark.imageName : null}
        error={watermark.error}
        onAdd={accept}
        onRemove={() => {
          setParams('watermark', {
            imageId: null,
            imageName: null,
            imagePath: null,
            imageMeta: null,
          });
        }}
        onMove={() => undefined}
      />

      <Choice
        legend="Position"
        name="watermark-position"
        columns={3}
        value={watermark.position}
        options={WATERMARK_POSITIONS.map((option) => ({
          value: option.value,
          label: option.label,
          detail: '',
        }))}
        onChange={(value) => {
          setParams('watermark', { position: value });
        }}
      />

      <Row>
        <NumberField
          label="Opacity"
          value={watermark.opacity}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(value) => {
            setParams('watermark', { opacity: Math.round(value) });
          }}
          meaning="100 is solid, 50 is a watermark you can see through."
        />
      </Row>

      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: `${meta.video?.codec ?? 'none'}, re-encoded at CRF 20`,
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'copied, untouched' },
        ]}
      />

      <Note>
        The mark is capped at a quarter of the frame so it never takes over, and stamping it means
        re-encoding the picture at CRF 20. The sound copies untouched.
      </Note>
    </Panel>
  );
}

export function Fade({ meta }: { readonly meta: ProbeResult }) {
  return <FadeFields meta={meta} audioOnly={false} />;
}

export function AudioFade({ meta }: { readonly meta: ProbeResult }) {
  return <FadeFields meta={meta} audioOnly />;
}

function FadeFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioFade' : 'fade';
  const { fadeInSec, fadeOutSec } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Fade in"
          value={fadeInSec}
          min={0}
          max={10}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams(key, { fadeInSec: Math.round(value * 2) / 2 });
          }}
          meaning="Rises from black and silence over this long. 0 means none."
        />
        <NumberField
          label="Fade out"
          value={fadeOutSec}
          min={0}
          max={10}
          step={0.5}
          suffix="s"
          onChange={(value) => {
            setParams(key, { fadeOutSec: Math.round(value * 2) / 2 });
          }}
          meaning="Settles to black and silence over this long. 0 means none."
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: audioOnly ? 'copied, untouched' : 'faded, re-encoded',
          },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'faded, as aac' },
        ]}
      />
      <Note>
        {audioOnly
          ? 'Only the sound fades; the picture is copied across untouched.'
          : 'Picture and sound fade together, and both are re-encoded, because a fade is written into the pixels and the samples themselves.'}
      </Note>
    </Panel>
  );
}

export function Loop({ meta }: { readonly meta: ProbeResult }) {
  return <LoopFields meta={meta} audioOnly={false} />;
}

export function AudioLoop({ meta }: { readonly meta: ProbeResult }) {
  return <LoopFields meta={meta} audioOnly />;
}

function LoopFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioLoop' : 'loop';
  const { times } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Play it"
          value={times}
          min={2}
          max={16}
          suffix="times"
          onChange={(value) => {
            setParams(key, { times: Math.round(value) });
          }}
          ticks={[
            { at: 2, label: 'twice' },
            { at: 4, label: 'four times' },
            { at: 16, label: 'sixteen times' },
          ]}
          meaning={`The whole file plays ${String(times)} times in a row.`}
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Length',
            from: formatSeconds(meta.durationSec),
            to: formatSeconds(meta.durationSec * times),
          },
          { label: 'Picture', from: meta.video?.codec ?? 'none', to: 'copied, untouched' },
          { label: 'Sound', from: meta.audio?.codec ?? 'none', to: 'copied, untouched' },
        ]}
      />
      <Note>
        No re-encoding at all: the file is copied once and played again. This finishes about as fast
        as copying it.
      </Note>
    </Panel>
  );
}

export function Volume({ meta }: { readonly meta: ProbeResult }) {
  return <VolumeFields meta={meta} audioOnly={false} />;
}

export function AudioVolume({ meta }: { readonly meta: ProbeResult }) {
  return <VolumeFields meta={meta} audioOnly />;
}

function VolumeFields({
  meta,
  audioOnly,
}: {
  readonly meta: ProbeResult;
  readonly audioOnly: boolean;
}) {
  const key = audioOnly ? 'audioVolume' : 'volume';
  const { gainDb } = useScrubStore((state) => state.params[key]);
  const setParams = useScrubStore((state) => state.setParams);

  return (
    <Panel>
      <Row>
        <NumberField
          label="Gain"
          value={gainDb}
          min={-20}
          max={20}
          suffix="dB"
          onChange={(value) => {
            setParams(key, { gainDb: Math.round(value) });
          }}
          ticks={[
            { at: -12, label: 'much quieter' },
            { at: 6, label: 'a bit louder' },
            { at: 12, label: 'much louder' },
          ]}
          meaning={
            gainDb === 0
              ? 'No change at all, which would just waste an encode.'
              : gainDb > 0
                ? `Everything sounds ${String(gainDb)} dB louder, and the loudest parts may distort.`
                : `Everything sounds ${String(Math.abs(gainDb))} dB quieter.`
          }
        />
      </Row>
      <Readout
        lines={[
          {
            label: 'Picture',
            from: meta.video?.codec ?? 'none',
            to: audioOnly ? 'none' : 'copied, untouched',
          },
          {
            label: 'Sound',
            from: meta.audio?.codec ?? 'none',
            to: `as aac, ${gainDb > 0 ? '+' : ''}${String(gainDb)} dB`,
          },
        ]}
      />
      <Note>
        {audioOnly
          ? 'Only the sound is re-encoded, as aac 192k.'
          : 'The picture is copied bit for bit; only the sound is re-encoded, as aac 192k.'}
      </Note>
    </Panel>
  );
}
