/* Subtitles, as text over the video.
 *
 * Burning subtitles into the picture is a transcode, and a transcode of a 4K
 * file is the one thing that gets a session killed on a server we do not own.
 * So they are never burned in: the text track is fetched as an ordinary file,
 * parsed here, and drawn in a div over the video element. That costs the server
 * one small GET and nothing else, and it works identically whether the film is
 * direct playing or being converted.
 *
 * Handles SRT and WebVTT, which are the two things a Plex server hands back for
 * a text subtitle stream. They differ in the decimal separator and a header
 * line, and in nothing else that matters here.
 */

/** '01:23:45,678', '01:23:45.678' and '23:45.67' all appear in the wild. */
export function seconds(stamp: string): number | null {
  const parts = /(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/.exec(String(stamp));
  if (!parts?.[2] || !parts[3]) return null;
  const fraction = parts[4] ? parseInt(parts[4], 10) / Math.pow(10, parts[4].length) : 0;
  const hours = parts[1] ? parseInt(parts[1], 10) : 0;
  return hours * 3600 + parseInt(parts[2], 10) * 60 + parseInt(parts[3], 10) + fraction;
}

/* Markup a TV has no business rendering: SRT's HTML-ish tags, ASS override
   blocks that survive a conversion, and the position hints WebVTT puts after
   the timestamp. Plain text is what the overlay draws. */
function strip(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\s+$/, '');
}

/** Cues in time order, in seconds. */
export function parse(text: string | null | undefined): Cue[] {
  const lines = String(text ?? '')
    .replace(/\r/g, '')
    .split('\n');
  const cues: Cue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const arrow = line.indexOf('-->');
    if (arrow < 0) continue;
    const start = seconds(line.substring(0, arrow));
    const end = seconds(line.substring(arrow + 3));
    if (start === null || end === null) continue;

    const body: string[] = [];
    for (i++; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      if (raw.replace(/\s/g, '') === '') break;
      /* A cue number on its own line belongs to the NEXT cue, so stop before
         swallowing it — otherwise every cue ends with a stray digit. */
      if (/^\d+$/.test(raw.trim()) && (lines[i + 1] ?? '').indexOf('-->') >= 0) {
        i--;
        break;
      }
      const cleaned = strip(raw);
      if (cleaned !== '') body.push(cleaned);
    }
    if (body.length) cues.push({ start, end, text: body.join('\n') });
  }

  return cues.sort((one, two) => one.start - two.start);
}

/* First cue index starting after `at`. Binary, because a two-hour film has a
   couple of thousand cues and this runs on every timeupdate. */
function after(cues: Cue[], at: number): number {
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((cues[mid]?.start ?? 0) <= at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** How far back an open cue can have started. */
const OVERLAP = 12;

/* What should be on screen at `at`, or '' for nothing. Cues overlap — two
   speakers, or a sign translated over dialogue — so this collects every one
   still open rather than the newest. */
export function textAt(cues: Cue[] | null | undefined, at: number): string {
  if (!cues?.length) return '';
  const out: string[] = [];
  const index = after(cues, at);
  const stop = Math.max(0, index - OVERLAP);
  for (let j = index - 1; j >= stop; j--) {
    const cue = cues[j];
    if (cue && cue.end > at) out.unshift(cue.text);
  }
  return out.join('\n');
}
