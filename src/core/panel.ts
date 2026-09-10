/* What this panel claims it can play, and the profile Plex is given.
   Only "probably" is acted on: "maybe" is what a TV says when it has not been
   asked precisely enough, and acting on it is how you get a black screen.
   Widening support is a matter of the panel answering differently, not of
   editing a string and hoping. */

type Kind = 'container' | 'video' | 'audio';

/* Known good on a B8. A probe can add to this; it can never take anything
   away, because a TV that answers "" for a type it plays perfectly well is a
   common enough thing. */
const BASE: Record<Kind, Record<string, boolean>> = {
  container: { mkv: true, mp4: true, mpegts: true },
  video: { h264: true, hevc: true },
  audio: { aac: true, ac3: true, eac3: true, mp3: true },
};

/** Nothing here is claimed unless the answer comes back "probably". */
const CANDIDATES: { kind: Kind; name: string; mime: string }[] = [
  { kind: 'video', name: 'vp9', mime: 'video/webm; codecs="vp9"' },
  { kind: 'video', name: 'vp8', mime: 'video/webm; codecs="vp8"' },
  { kind: 'video', name: 'av1', mime: 'video/mp4; codecs="av01.0.05M.08"' },
  { kind: 'video', name: 'mpeg2video', mime: 'video/mpeg' },
  { kind: 'video', name: 'vc1', mime: 'video/x-ms-wmv' },
  { kind: 'video', name: 'mpeg4', mime: 'video/mp4; codecs="mp4v.20.8"' },

  { kind: 'container', name: 'webm', mime: 'video/webm' },
  { kind: 'container', name: 'avi', mime: 'video/x-msvideo' },
  { kind: 'container', name: 'mov', mime: 'video/quicktime' },
  { kind: 'container', name: 'asf', mime: 'video/x-ms-asf' },

  /* Audio is asked about for the report only — what the panel decodes is a
     different question from what survives HDMI ARC, and rules/audio owns that. */
  { kind: 'audio', name: 'flac', mime: 'audio/flac' },
  { kind: 'audio', name: 'opus', mime: 'audio/ogg; codecs="opus"' },
  { kind: 'audio', name: 'vorbis', mime: 'audio/ogg; codecs="vorbis"' },
  { kind: 'audio', name: 'dts', mime: 'audio/vnd.dts' },
  { kind: 'audio', name: 'truehd', mime: 'audio/true-hd' },
];

interface Answer {
  kind: Kind;
  name: string;
  mime: string;
  said: string;
}

let answers: Answer[] | null = null;
let capabilities: Record<Kind, Record<string, boolean>> | null = null;
let features: PanelFeatures | null = null;

function video(): HTMLVideoElement | null {
  return document.getElementById('video') as HTMLVideoElement | null;
}

function ask(mime: string): string {
  const element = video();
  if (!element?.canPlayType) return '';
  try {
    return element.canPlayType(mime) || '';
  } catch {
    return '';
  }
}

export function probe(): Answer[] {
  if (answers) return answers;
  answers = [];
  capabilities = { container: {}, video: {}, audio: {} };

  (Object.keys(BASE) as Kind[]).forEach((kind) => {
    Object.keys(BASE[kind]).forEach((name) => {
      (capabilities as Record<Kind, Record<string, boolean>>)[kind][name] = true;
    });
  });

  CANDIDATES.forEach((candidate) => {
    const said = ask(candidate.mime);
    (answers as Answer[]).push({ ...candidate, said });
    if (said === 'probably' && candidate.kind !== 'audio') {
      (capabilities as Record<Kind, Record<string, boolean>>)[candidate.kind][candidate.name] =
        true;
    }
  });
  return answers;
}

/* What the pipeline offers past the basics. On webOS a <video> element is not
   the browser decoding — WAM hands playback to the TV's own media pipeline, the
   same hardware decoder the built-in player uses, which is why 4K HEVC direct
   plays here and fails in a desktop browser.

   audioTracks is the one that matters most: with it, switching audio is a
   client-side selection; without it the only honest way is to ask the server
   for that track and restart. */
export function probeFeatures(): PanelFeatures {
  if (features) return features;
  const element = video() as (HTMLVideoElement & Record<string, unknown>) | null;
  const has = (name: string) => !!element && name in element;
  features = {
    audioTracks: has('audioTracks')
      ? String((element?.audioTracks as { length?: number } | undefined)?.length ?? 0)
      : 'no',
    videoTracks: has('videoTracks') ? 'yes' : 'no',
    textTracks: has('textTracks') ? 'yes' : 'no',
    playbackQuality: !!(
      element &&
      (element.getVideoPlaybackQuality || element.webkitDecodedFrameCount !== undefined)
    ),
    mediaSource: typeof window !== 'undefined' && !!window.MediaSource,
    webOS: typeof window !== 'undefined' && !!window.webOS,
    webOSVersion:
      (typeof window !== 'undefined' &&
        (window.webOS as { device?: { platformVersion?: string } } | undefined)?.device
          ?.platformVersion) ||
      '?',
  };
  return features;
}

export function supports(kind: Kind, name: string | undefined): boolean {
  if (!capabilities) probe();
  return (
    (capabilities as Record<Kind, Record<string, boolean>>)[kind][
      String(name ?? '').toLowerCase()
    ] === true
  );
}

export function list(kind: Kind): string[] {
  if (!capabilities) probe();
  return Object.keys((capabilities as Record<Kind, Record<string, boolean>>)[kind]);
}

/** The declaration Plex is given, built from what the panel claims. */
export function clientProfile(): string {
  if (!capabilities) probe();
  const videoCodecs = list('video').join(',');
  const audioCodecs = list('audio').join(',');
  const out = list('container').map(
    (container) =>
      `add-direct-play-profile(type=videoProfile&container=${container}` +
      `&codec=${videoCodecs}&audioCodec=${audioCodecs})`,
  );
  /* The two limits that are about this panel rather than about codecs: H.264
     above level 5.1 and HEVC above 10-bit are beyond it. */
  out.push(
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&isRequired=false)',
    'add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10&isRequired=false)',
  );
  return out.join('+');
}

/* For the panel chip: what was asked and what came back, so widening is a
   decision made on evidence. */
export function report(): string {
  const rows = probe();
  const lines: string[] = [
    'DECLARED TO THE SERVER',
    `containers   ${list('container').join(', ')}`,
    `video        ${list('video').join(', ')}`,
    `audio        ${list('audio').join(', ')}`,
    '',
    'PANEL ANSWERED  (only "probably" is acted on)',
  ];

  (['video', 'container', 'audio'] as Kind[]).forEach((kind) => {
    const said = rows
      .filter((row) => row.kind === kind)
      .map((row) => `${row.name}=${row.said || 'no'}`);
    const gap = kind === 'container' ? '    ' : '        ';
    lines.push(kind + gap + said.join('  '));
  });

  const found = probeFeatures();
  lines.push(
    '',
    'PIPELINE',
    `audioTracks  ${found.audioTracks}    textTracks ${found.textTracks}` +
      `    MediaSource ${found.mediaSource ? 'yes' : 'no'}`,
    `webOS ${found.webOS ? found.webOSVersion : 'no'}` +
      `    frame stats ${found.playbackQuality ? 'yes' : 'no'}`,
    '',
    'Audio over ARC is a separate question: TrueHD and DTS-HD MA never',
    'pass, whatever the panel decodes.',
  );
  return lines.join('\n');
}
