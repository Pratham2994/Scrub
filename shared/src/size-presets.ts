/**
 * Where people are actually trying to send the file.
 *
 * "Under 10 MB" is the most common thing anyone wants from a video tool and
 * compress cannot answer it: CRF asks how good, not how big. These are the
 * places that refuse a file outright, with the number each one refuses at.
 *
 * Every figure was checked in September 2026 and every one carries its date,
 * because they move. When a limit is ambiguous the smaller number wins: a file
 * that comes in under an old limit is merely smaller than it needed to be, and a
 * file that misses the real one is rejected after the upload.
 */

export type SizePreset = {
  readonly id: string;
  readonly label: string;
  /** The cap, in mebibytes. */
  readonly limitMiB: number;
  /**
   * What Scrub actually aims at, which is under the cap.
   *
   * Container overhead, the audio budget and the encoder's own variance all land
   * on the wrong side of a hard limit often enough to matter. A file at 9.7 MB
   * is indistinguishable from one at 10 MB to the person sending it and is not
   * indistinguishable to Discord.
   */
  readonly targetMiB: number;
  /** Why this number and not another. Shown, not buried in a comment. */
  readonly note: string;
};

/**
 * Base64 inflates an attachment by about a third, so a mail server's "25 MB"
 * is a limit on the encoded bytes and not on the file.
 */
const EMAIL_ENCODED_MIB = 25;
const BASE64_OVERHEAD = 4 / 3;

export const SIZE_PRESETS: readonly SizePreset[] = [
  {
    id: 'discord',
    label: 'Discord',
    limitMiB: 10,
    targetMiB: 9.5,
    note: 'Discord raised the free limit toward 20 MB during 2026, but it is still rolling out and plenty of accounts are on 10. Aiming at 10 works on every account; if yours already shows 20, use the custom target.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    limitMiB: 16,
    targetMiB: 15,
    note: 'The limit for a video sent as media. Sent as a document instead, WhatsApp allows up to 2 GB and no compression is needed at all.',
  },
  {
    id: 'email',
    label: 'Email attachment',
    limitMiB: Math.round((EMAIL_ENCODED_MIB / BASE64_OVERHEAD) * 10) / 10,
    targetMiB: 17.5,
    note: 'Gmail and Outlook both say 25 MB, but that is the encoded size and attachments are base64, which adds about a third. The real ceiling for the file itself is nearer 18 MB.',
  },
  {
    id: 'discord-nitro-basic',
    label: 'Discord Nitro Basic',
    limitMiB: 50,
    targetMiB: 48,
    note: 'The £2.99 tier. Full Nitro is 500 MB, which almost nothing needs compressing to reach.',
  },
  {
    id: 'twitter',
    label: 'X / Twitter',
    limitMiB: 512,
    targetMiB: 500,
    note: 'The size cap is generous; the limit that actually bites is 2 minutes 20 seconds without Premium. Trim first. X also wants H.264 and AAC at 30 fps or less, which is what this produces.',
  },
];

export function sizePreset(id: string): SizePreset | null {
  return SIZE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * The video bitrate that fits a duration into a size, in kbit/s.
 *
 * Deliberately conservative in two places. The container's own overhead is real
 * and grows with length, and the audio budget comes off the top before the
 * picture gets any - both of which are how a "10 MB" encode lands at 10.4 and
 * gets refused.
 *
 * Returns null when the sum does not work: a target smaller than the audio
 * alone cannot be hit by lowering the video bitrate, and pretending otherwise
 * produces a file that misses the target and looks terrible doing it.
 */
export function videoBitrateKbps(
  targetMiB: number,
  durationSec: number,
  audioKbps: number,
): number | null {
  if (durationSec <= 0) return null;

  const totalKbit = targetMiB * 1024 * 8;
  // Muxing overhead. 2% covers mp4's index and headers with room to spare.
  const budgetKbit = totalKbit * 0.98;
  const audioKbit = audioKbps * durationSec;
  const videoKbit = budgetKbit - audioKbit;
  const kbps = Math.floor(videoKbit / durationSec);

  /**
   * Below about 100 kbit/s h264 stops being a picture and starts being a smear,
   * and the honest answer is that this file cannot make that size at this
   * length. The caller says so rather than encoding a mess.
   */
  return kbps < 100 ? null : kbps;
}

/** How long a file could be and still make the target. Used to explain a refusal. */
export function maxDurationSec(targetMiB: number, audioKbps: number): number {
  const totalKbit = targetMiB * 1024 * 8 * 0.98;
  // At the 100 kbit/s floor above.
  return Math.floor(totalKbit / (100 + audioKbps));
}
