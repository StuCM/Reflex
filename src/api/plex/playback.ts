/* The decision call, where to play from, and reporting progress. */
import { ask, queryString, request, uuid } from './client';

let sessionId: string | null = null;
function session(): string {
  sessionId ??= uuid();
  return sessionId;
}

/* opts.maxBitrate is the quality menu. It only means anything on a converted
   stream — asking for a cap IS asking the server to re-encode — so the decision
   call is given it too and answers honestly that it will transcode. On a 4K
   file that is a refusal, which is the point.

   opts.forceStream is audio track selection. On a DIRECT PLAY the server hands
   over the original file whole; `audioStreamID` is advice to the decision
   engine and changes not one byte of it, so the panel plays whichever track it
   likes. The only way to be given a specific one is to stop asking for direct
   play. That costs a session — the honest price of choosing, paid only when the
   panel cannot choose for us. */
function playbackParameters(
  server: PlexServer,
  item: PlexItem,
  mediaIndex: number,
  partIndex: number,
  audioStreamId: string | number | null,
  options: PlaybackOptions = {},
): Record<string, string | number | null> {
  return {
    hasMDE: 1,
    path: `/library/metadata/${item.ratingKey}`,
    mediaIndex,
    partIndex,
    protocol: 'http',
    directPlay: options.maxBitrate || options.forceStream ? 0 : 1,
    directStream: 1,
    directStreamAudio: 1,
    fastSeek: 1,
    /* Never burned in: burning is a transcode, and a transcode of a 4K file is
       what gets a session killed. Fetched as text and drawn over the video. */
    subtitles: 'none',
    audioBoost: 100,
    /* directPlay is off the table once a cap is asked for; leaving it on makes
       the server answer directplay and ignore the cap entirely. */
    maxVideoBitrate: options.maxBitrate ?? null,
    videoBitrate: options.maxBitrate ?? null,
    autoAdjustQuality: 0,
    mediaBufferSize: 102400,
    /* We connect directly, not via relay, so 'lan' keeps the server's
       remote-quality cap out of the decision. */
    location: 'lan',
    session: session(),
    audioStreamID: audioStreamId ?? null,
    /* In the query, not just the header: the transcode endpoints rebuild this
       URL internally and look for the token in it, refusing with a 400 rather
       than a 401 when it is missing. */
    'X-Plex-Token': server.token,
    'X-Plex-Client-Profile-Extra': Panel.clientProfile(),
  };
}

interface DecisionContainer {
  MediaContainer?: {
    Metadata?: PlexItem[];
    transcodeDecisionText?: string;
    generalDecisionText?: string;
    mdeDecisionText?: string;
  };
}

/* hasMDE=1 returns the verdict WITHOUT opening a session, so this is safe to
   call on a server we do not own. Never call the non-decision endpoints. */
export function decide(
  server: PlexServer,
  item: PlexItem,
  mediaIndex: number,
  partIndex: number,
  audioStreamId: string | number | null,
  options?: PlaybackOptions,
): Promise<PlexDecision> {
  const parameters = playbackParameters(
    server,
    item,
    mediaIndex,
    partIndex,
    audioStreamId,
    options,
  );
  return ask(server, `/video/:/transcode/universal/decision?${queryString(parameters)}`, {
    timeout: 20000,
  }).then((response) => {
    const container = (response as DecisionContainer).MediaContainer ?? {};
    const found = container.Metadata?.[0];
    const part = found?.Media?.[0]?.Part?.[0];
    const streams = part?.Stream ?? [];
    /* Per stream, so "the audio needs re-encoding" can be told apart from "the
       whole thing does" — one is acceptable, the other kills a 4K session. */
    const video = streams.find((stream) => stream.streamType === 1);
    const audio = streams.find((stream) => stream.streamType === 2);
    return {
      decision: (part as { decision?: string } | undefined)?.decision ?? 'unknown',
      video: (video as { decision?: string } | undefined)?.decision ?? '',
      audio: (audio as { decision?: string } | undefined)?.decision ?? '',
      text:
        container.transcodeDecisionText ??
        container.generalDecisionText ??
        container.mdeDecisionText ??
        '',
      raw: container as Record<string, unknown>,
    };
  });
}

/* HLS, because that is what the panel's own pipeline handles — a desktop
   browser will not play it, so it cannot be tested on the laptop. Calling this
   DOES open a session. */
export function transcodeUrl(
  server: PlexServer,
  item: PlexItem,
  mediaIndex: number,
  partIndex: number,
  audioStreamId: string | number | null,
  options?: PlaybackOptions,
): string {
  const parameters = playbackParameters(
    server,
    item,
    mediaIndex,
    partIndex,
    audioStreamId,
    options,
  );
  parameters.hasMDE = null;
  parameters.protocol = 'hls';
  parameters.copyts = 1;
  parameters.directPlay = 0;
  return `${server.base}/video/:/transcode/universal/start.m3u8?${queryString(parameters)}`;
}

export function streamUrl(server: PlexServer, part: PlexPart): string {
  return `${server.base}${part.key}?${queryString({ 'X-Plex-Token': server.token })}`;
}

/* One small GET for the whole text track, which is the entire cost of
   subtitles here — no session, no re-encode, nothing on the dashboard. */
export function subtitleUrl(server: PlexServer, stream: PlexStream): string {
  const path = stream.key ?? `/library/streams/${stream.id}`;
  return `${server.base}${path}?${queryString({ encoding: 'utf-8', 'X-Plex-Token': server.token })}`;
}

export function subtitles(server: PlexServer, stream: PlexStream): Promise<string> {
  return request('GET', subtitleUrl(server, stream), { timeout: 15000 }).then((body) => {
    /* request() parses JSON when it can; a subtitle file never is one, so
       anything but a string means the server answered with something else. */
    if (typeof body !== 'string' || !body) throw new Error('the server returned no text');
    return body;
  });
}

/* Reported to the server being played from. Plex syncs the position to the
   account, which is why the same film resumes in the right place on the other
   server. */
export function timeline(
  server: PlexServer,
  item: PlexItem,
  playbackState: string,
  timeMs: number,
  durationMs: number,
): Promise<unknown> {
  return ask(
    server,
    `/:/timeline?${queryString({
      ratingKey: item.ratingKey,
      key: `/library/metadata/${item.ratingKey}`,
      state: playbackState,
      time: Math.floor(timeMs),
      duration: Math.floor(durationMs),
      playbackTime: Math.floor(timeMs),
      hasMDE: 1,
    })}`,
    { timeout: 8000 },
  ).catch(() => null);
}
