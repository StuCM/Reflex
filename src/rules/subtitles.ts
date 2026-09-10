/* Two kinds of subtitle, and the difference decides whether they can be shown
 * at all.
 *
 * A text subtitle is a file of words: fetch it, parse it, draw it over the
 * video, and the server does no work. An image subtitle (PGS on a Blu-ray
 * remux, VOBSUB on a DVD rip) is a picture of words, and the only way to put it
 * on screen is to have the server paint it into the video — a transcode, which
 * on a 4K file is exactly what gets the session killed.
 *
 * So image tracks are listed and refused, with the reason, rather than quietly
 * missing.
 */
import { isCommentary } from './audio';
import { langName } from './language';

const TEXT_SUBS: Record<string, true> = {
  srt: true,
  subrip: true,
  ass: true,
  ssa: true,
  vtt: true,
  webvtt: true,
  text: true,
  mov_text: true,
  subtitle: true,
};

const SUBTITLE = 3;

/** Can this be drawn over the video, or is it a picture that needs burning in? */
export function isTextSub(stream: PlexStream | null | undefined): boolean {
  return TEXT_SUBS[String(stream?.codec ?? '').toLowerCase()] === true;
}

export function subtitleTracks(part: PlexPart | null | undefined): PlexStream[] {
  return (part?.Stream ?? []).filter((stream) => stream.streamType === SUBTITLE);
}

export function subLabel(stream: PlexStream | null | undefined): string {
  if (!stream) return 'Off';
  const name = langName(stream) || 'Unknown';
  const bits: string[] = [];
  if (stream.forced) bits.push('forced');
  if (isCommentary(stream)) bits.push('commentary');
  if (stream.hearingImpaired || /sdh/i.test(String(stream.title ?? ''))) bits.push('SDH');
  if (!isTextSub(stream)) bits.push(`${String(stream.codec ?? '?').toUpperCase()}, image`);
  else if (stream.title && String(stream.title).length < 24) bits.push(String(stream.title));
  return name + (bits.length ? ` · ${bits.join(' · ')}` : '');
}

/* Which track to start with when the user asks for subtitles and has not said
   which: the one matching the language they last chose, else the one the file
   marks selected, else a plain forced track (a foreign-dialogue caption on an
   English film), else the first text one. Never an image track — it cannot be
   drawn — and never a commentary. */
export function pickSubtitle(
  part: PlexPart | null | undefined,
  languageCode?: string,
): PlexStream | null {
  const usable = subtitleTracks(part).filter(
    (stream) => isTextSub(stream) && !isCommentary(stream),
  );
  if (!usable.length) return null;

  const wanted = String(languageCode ?? '').toLowerCase();
  if (wanted) {
    const match = usable.find(
      (stream) => String(stream.languageCode ?? '').toLowerCase() === wanted,
    );
    if (match) return match;
  }
  return (
    usable.find((stream) => stream.selected) ??
    usable.find((stream) => stream.forced) ??
    usable[0] ??
    null
  );
}
