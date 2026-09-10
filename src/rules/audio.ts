/* Which audio track we are willing to play, and what to call it.
 *
 * ARC (not eARC) on a 2018 set. TrueHD and DTS-HD MA can never pass; plain DTS
 * is a coin flip on this generation, so it sits below AAC. See CLAUDE.md.
 */
import { langName } from './language';

const AUDIO_RANK: Record<string, number> = {
  eac3: 5,
  'ec-3': 5,
  ac3: 4,
  aac: 3,
  mp3: 2,
  dca: 1,
  dts: 1,
};

/* A director's commentary is a perfectly good AC3 5.1 by every measure this
   ranking uses, and picking it ruins the film. It is also exactly what gets
   picked on a remux whose main track is TrueHD, because excluding the TrueHD
   leaves the commentary as the only passable thing on the file.

   Plex puts the word in the stream's title rather than flagging it, so this is
   a text match — deliberately broad, because being wrong the other way means
   two hours of someone talking over the film. */
const NOT_THE_FILM =
  /commentar|descriptive|description|narrat|audio ?desc|\bdvs\b|\bad\b sign|karaoke/i;

const AUDIO = 2;

/** Is this someone talking over the film rather than the film? */
export function isCommentary(stream: PlexStream | null | undefined): boolean {
  if (!stream) return false;
  const text = [stream.title, stream.displayTitle, stream.extendedDisplayTitle].join(' ');
  return NOT_THE_FILM.test(text);
}

/* Can this track reach the amplifier untouched? Anything the ranking does not
   know about is assumed not to. Says nothing about whether the track is worth
   playing — that is isCommentary's job. */
export function passesArc(stream: PlexStream | null | undefined): boolean {
  const codec = (stream?.codec ?? '').toLowerCase();
  const profile = (stream?.profile ?? '').toLowerCase();
  if (codec === 'truehd') return false;
  if ((codec === 'dca' || codec === 'dts') && profile.startsWith('ma')) return false;
  return AUDIO_RANK[codec] !== undefined;
}

function audioScore(stream: PlexStream): number {
  const codec = (stream.codec ?? '').toLowerCase();
  if (isCommentary(stream)) return -1;
  if (!passesArc(stream)) return -1;
  const rank = AUDIO_RANK[codec] ?? 0;
  const channels = stream.channels ?? 2;
  const bonus = rank >= 4 ? Math.min(channels, 6) : channels <= 2 ? 6 : 1;
  return rank * 100 + bonus * 2 + (stream.selected ? 1 : 0);
}

function best(streams: PlexStream[], score: (stream: PlexStream) => number): PlexStream | null {
  let winner: PlexStream | null = null;
  let winning = -1;
  streams.forEach((stream) => {
    const points = score(stream);
    if (points > winning) {
      winning = points;
      winner = stream;
    }
  });
  return winning < 0 ? null : winner;
}

/** Every audio track on a part, in file order — what the player cycles through. */
export function audioTracks(part: PlexPart | null | undefined): PlexStream[] {
  return (part?.Stream ?? []).filter((stream) => stream.streamType === AUDIO);
}

/** The best track that crosses ARC untouched, or null if every one would transcode. */
export function pickAudio(part: PlexPart | null | undefined): PlexStream | null {
  return best(audioTracks(part), audioScore);
}

/* The best track when nothing passes — the film's own audio, transcoded. Still
   never a commentary: that is about playing the right thing, not about what the
   link can carry. Channel count wins here because the server is going to
   re-encode it anyway, so we may as well start from the good one. */
export function bestAudio(part: PlexPart | null | undefined): PlexStream | null {
  const usable = audioTracks(part).filter((stream) => !isCommentary(stream));
  return best(
    usable,
    (stream) =>
      Math.min(stream.channels ?? 2, 8) * 10 + (stream.selected ? 5 : 0) + (stream.default ? 2 : 0),
  );
}

export function streamById(
  part: PlexPart | null | undefined,
  id: string | number,
): PlexStream | null {
  const found = (part?.Stream ?? []).find((stream) => String(stream.id) === String(id));
  return found ?? null;
}

function channelLabel(stream: PlexStream): string {
  if (stream.channels === 6) return '5.1';
  if (stream.channels === 8) return '7.1';
  return `${stream.channels ?? '?'}.0`;
}

/** "AC3 5.1 ENG" — the badge form. */
export function audioLabel(stream: PlexStream | null | undefined): string {
  if (!stream) return 'no passable track';
  const codec = (stream.codec ?? '?').toUpperCase();
  const language = stream.languageCode ? ` ${stream.languageCode.toUpperCase()}` : '';
  return `${codec} ${channelLabel(stream)}${language}`;
}

/* The same track, named for a menu the user is reading rather than a badge they
   are glancing at: language first, because that is what they are choosing
   between, and the codec after, because that is what decides whether it passes
   over ARC. */
export function audioMenuLabel(stream: PlexStream | null | undefined): string {
  if (!stream) return 'no passable track';
  return (
    `${langName(stream) || 'Unknown'} · ${(stream.codec ?? '?').toUpperCase()} ` +
    channelLabel(stream) +
    (isCommentary(stream) ? ' · commentary' : '') +
    (passesArc(stream) ? '' : ' · needs re-encoding')
  );
}

/* What the file actually offers, for a refusal that says something useful.
   "only TrueHD or DTS-HD MA" was a lie the moment commentary tracks started
   being excluded too. */
export function audioSummary(part: PlexPart | null | undefined): string {
  const listed = audioTracks(part).map(
    (stream) => audioLabel(stream) + (isCommentary(stream) ? ' (commentary)' : ''),
  );
  return listed.join(', ') || 'no audio tracks at all';
}
