/* Which audio track we are willing to play, and what to call it.
   ARC, not eARC: TrueHD and DTS-HD MA can never pass, and plain DTS is a
   coin flip on this panel, so it ranks below AAC. */
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

/* Plex does not flag commentary, so this is a text match — deliberately
   broad. On a TrueHD remux the commentary is the only passable track left, so
   without this it wins. */
const NOT_THE_FILM =
  /commentar|descriptive|description|narrat|audio ?desc|\bdvs\b|\bad\b sign|karaoke/i;

const AUDIO = 2;

/** Is this someone talking over the film rather than the film? */
export function isCommentary(stream: PlexStream | null | undefined): boolean {
  if (!stream) return false;
  const text = [stream.title, stream.displayTitle, stream.extendedDisplayTitle].join(' ');
  return NOT_THE_FILM.test(text);
}

/* Anything the ranking does not know is assumed not to pass. */
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

/* When nothing passes: the film's own audio, re-encoded. Channel count wins
   because the server is re-encoding anyway. Never a commentary. */
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

/* For a menu rather than a badge: language first, since that is what is being
   chosen between. */
export function audioMenuLabel(stream: PlexStream | null | undefined): string {
  if (!stream) return 'no passable track';
  return (
    `${langName(stream) || 'Unknown'} · ${(stream.codec ?? '?').toUpperCase()} ` +
    channelLabel(stream) +
    (isCommentary(stream) ? ' · commentary' : '') +
    (passesArc(stream) ? '' : ' · needs re-encoding')
  );
}

/* What the file offers, so a refusal can say something useful. */
export function audioSummary(part: PlexPart | null | undefined): string {
  const listed = audioTracks(part).map(
    (stream) => audioLabel(stream) + (isCommentary(stream) ? ' (commentary)' : ''),
  );
  return listed.join(', ') || 'no audio tracks at all';
}
