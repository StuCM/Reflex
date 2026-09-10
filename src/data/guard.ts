/* Will this copy play, and at what cost to a server we do not own.
   Everything that reaches the player goes through here first. Resolves with a
   verdict, never rejects. */
import { decide } from '../api/plex/playback';
import { audioLabel, audioSummary, bestAudio, pickAudio, streamById } from '../rules/audio';
import { allows, canDecode, isUHD } from '../rules/quality';
import { load } from './meta';
import * as servers from './servers';
import { debug } from '../core/ui';

/* mediaIndex picks which version of this copy to check: one library item can
   hold several, and a 4K remux and a 1080p encode get different verdicts.

   forceAudioId overrides the choice — that is how switching track in the player
   works, since the ranking would otherwise pick the same one again.

   options.maxBitrate is the quality menu. Asking for a cap is asking the server
   to re-encode, so the decision comes back 'transcode' — which on a 4K file is
   a refusal, arrived at by the ordinary rule rather than a special case.
   options.forceStream is the same shape of thing for audio. */
export function check(
  item: PlexItem,
  mediaIndex = 0,
  forceAudioId?: string | number,
  options: PlaybackOptions = {},
): Promise<Verdict> {
  return load(item).then(
    (metadata): Verdict | Promise<Verdict> => {
      if (!metadata) return { ok: false, state: 'nometa', text: 'No metadata for this copy.' };

      const media = metadata.Media?.[mediaIndex];
      const part = media?.Part?.[0];
      if (!part) {
        return {
          ok: false,
          state: 'nopart',
          metadata,
          media,
          mediaIndex,
          text: 'This version has no playable part.',
        };
      }

      /* The track that passes as-is if there is one, otherwise the film's own
         audio, re-encoded by the server. */
      let passes: PlexStream | null | boolean = pickAudio(part);
      let audio = passes || bestAudio(part);
      if (forceAudioId) {
        const wanted = streamById(part, forceAudioId);
        if (wanted) {
          audio = wanted;
          passes = pickAudio(part) === wanted;
        }
      }
      if (!audio) {
        return {
          ok: false,
          state: 'noaudio',
          metadata,
          media,
          part,
          mediaIndex,
          audio: null,
          text: audioSummary(part),
        };
      }

      const server = servers.of(metadata);
      if (!server) return { ok: false, state: 'nometa', text: 'No server for this copy.' };

      return decide(server, metadata, mediaIndex, 0, audio.id, options).then(
        (verdict): Verdict => {
          const direct = verdict.decision === 'directplay';
          /* Only direct play hands the panel the original file. A re-encode
             arrives as H.264, which it always manages — so this check belongs
             here, not before the decision. */
          const undecodable = direct && !canDecode(media);
          debug(
            `decision: ${verdict.decision} · ${metadata.title}` +
              (servers.count() > 1 ? ` on ${server.name}` : '') +
              ` · ${audioLabel(audio)}` +
              (verdict.video || verdict.audio
                ? ` · v:${verdict.video || '?'} a:${verdict.audio || '?'}`
                : '') +
              ` ${verdict.text}`,
          );
          return {
            /* 4K must direct play or not play. Anything else may transcode. */
            ok: allows(media, direct),
            state: undecodable ? 'codec' : verdict.decision,
            transcode: !direct,
            video: verdict.video,
            audioDecision: verdict.audio,
            audio,
            passes: !!passes,
            maxBitrate: options.maxBitrate ?? null,
            forceStream: !!options.forceStream,
            metadata,
            media,
            part,
            mediaIndex,
            text: verdict.text || '',
          };
        },
        (error: Error): Verdict => ({
          ok: false,
          state: 'error',
          metadata,
          media,
          part,
          mediaIndex,
          audio,
          text: error.message,
        }),
      );
    },
    (error: Error): Verdict => ({ ok: false, state: 'error', text: error.message }),
  );
}

/** A short label for a verdict, for the source list. */
export function label(verdict: Verdict | null | undefined): string {
  if (!verdict) return 'checking…';
  if (verdict.ok && !verdict.transcode) return 'direct play';
  if (verdict.ok) {
    /* Not a direct play, but nothing re-encoded either: the server is muxing
       the file's own streams into a container, which is what choosing an audio
       track costs. Calling a remux a transcode is how you end up avoiding
       something that was cheap. */
    if (verdict.video === 'copy' && verdict.audioDecision === 'copy') return 'direct stream';
    /* Audio-only re-encoding is cheap and is the common case for a remux whose
       only track is TrueHD; a full re-encode is worth naming. */
    if (verdict.video && verdict.video !== 'transcode') return 'audio transcode';
    return 'server transcodes';
  }
  if (verdict.state === 'noaudio') return 'no passable audio';
  if (verdict.state === 'codec') return 'panel cannot decode';
  if (isUHD(verdict.media)) return '4K, would transcode';
  if (verdict.state === 'nopart') return 'nothing to play';
  if (verdict.state === 'nometa') return 'no metadata';
  if (verdict.state === 'error') {
    /* A server answering with a refusal is a different problem from it not
       answering, and saying the wrong one sends you looking at the network. */
    const status = /-> (\d{3})/.exec(verdict.text || '');
    return status?.[1] ? `server said ${status[1]}` : 'check failed';
  }
  return 'would transcode';
}

/** Why we are refusing, in full, for the message screen. */
export function refusal(item: PlexItem, verdict: Verdict): [string, string] {
  if (verdict.state === 'noaudio') {
    return [
      'No usable audio track',
      `${item.title} offers: ${verdict.text || 'nothing'}.  Nothing there is both ` +
        'passable over plain HDMI ARC and actually the film — TrueHD and DTS-HD MA ' +
        'cannot pass at all, and a commentary is not what you asked to watch. Playing ' +
        'it would force an audio transcode on a server we do not own, so it is refused.',
    ];
  }
  if (verdict.state === 'codec') {
    return [
      'This panel cannot decode it',
      `${item.title} is ${verdict.media?.videoCodec} in ${verdict.media?.container}. ` +
        'The B8 decodes H.264 and HEVC in MKV, MP4 or MPEG-TS. Playing it would give a ' +
        'black screen, so it is refused before asking the server.',
    ];
  }
  if (verdict.state === 'nopart') return ['Nothing to play', 'This copy has no playable part.'];
  if (verdict.state === 'nometa') {
    return ['No metadata', 'The server returned nothing for this copy.'];
  }
  if (verdict.state === 'error') return ['Could not check playback', verdict.text ?? ''];

  const why = verdict.text || `the server returned "${verdict.state}"`;
  /* The only thing still refused outright. */
  return [
    '4K transcode refused',
    `${item.title} will not direct play — ${why}. Starting it would register a 4K ` +
      'transcode on the server, which gets killed mid-stream. Another copy may direct ' +
      'play — check the list. Or run probe.py against this file to find which declared ' +
      'capability flips it.',
  ];
}
