/* Will this copy play, and at what cost to someone else's server?

   The rule is narrower than it first looks. The admin's limit is on transcoding
   *4K*, enforced by a kill-stream that fires after a session starts — so a 4K
   item that will not direct play outright is refused here, before anything
   opens. Below 4K, a transcode is ordinary server work and the server is
   perfectly able to refuse it itself; preferring direct play is right, insisting
   on it is not, and insisting is what made every TrueHD remux unplayable.

   So, in order, cheapest first:

     1. Can this panel decode the video at all? Free, and certain.
     2. Which audio track — the best one that passes over plain HDMI ARC as-is,
        and failing that the film's own track, which the server will re-encode.
        Never a commentary either way.
     3. What does the server say, asked with hasMDE=1, which returns the verdict
        WITHOUT opening a session.

   Every copy on every server goes through this, which is what lets the detail
   page say what each one will cost before you choose. */
var Guard = (function () {
  'use strict';

  /* Resolves with a verdict object, never rejects:
       { ok, state, transcode, audio, media, part, md, text }
     ok means we are willing to play it. transcode says the server will have to
     re-encode something to do it. */
  /* mediaIndex picks which version of this copy to check. One library item can
     hold several — a 4K remux and a 1080p encode of the same film are two
     entries in Media[], and they get different verdicts, so they are checked
     and played separately. */
  function check(item, mediaIndex) {
    var n = mediaIndex || 0;
    return Meta.load(item).then(function (md) {
      if (!md) return { ok: false, state: 'nometa', text: 'No metadata for this copy.' };

      var media = md.Media && md.Media[n];
      var part = media && media.Part && media.Part[0];
      if (!part) {
        return { ok: false, state: 'nopart', md: md, media: media, mediaIndex: n,
                 text: 'This version has no playable part.' };
      }

      /* The track that passes as-is if there is one, otherwise the film's own
         audio and the server re-encodes it. */
      var passes = Media.pickAudio(part);
      var audio = passes || Media.bestAudio(part);
      if (!audio) {
        return { ok: false, state: 'noaudio', md: md, media: media, part: part,
                 mediaIndex: n, audio: null, text: Media.audioSummary(part) };
      }

      var server = Servers.of(md);
      return Plex.decide(server, md, n, 0, audio.id).then(function (v) {
        var direct = v.decision === 'directplay';
        var uhd = Media.isUHD(media);
        /* Only direct play hands the panel the original file. A re-encode
           arrives as H.264, which it always manages — so this check belongs
           here, not before the decision. */
        var undecodable = direct && !Media.canDecode(media);
        var willing = Media.allows(media, direct);
        UI.debug('decision: ' + v.decision + ' · ' + md.title +
                 (Servers.count() > 1 ? ' on ' + server.name : '') +
                 ' · ' + Media.audioLabel(audio) +
                 (v.video || v.audio ? ' · v:' + (v.video || '?') + ' a:' + (v.audio || '?') : '') +
                 ' ' + v.text);
        return {
          /* 4K must direct play or not play. Anything else may transcode. */
          ok: willing,
          state: undecodable ? 'codec' : v.decision,
          transcode: !direct,
          video: v.video, audioDecision: v.audio,
          audio: audio, passes: !!passes,
          md: md, media: media, part: part, mediaIndex: n,
          text: v.text || ''
        };
      }, function (e) {
        return { ok: false, state: 'error', md: md, media: media, part: part,
                 mediaIndex: n, audio: audio, text: e.message };
      });
    }, function (e) {
      return { ok: false, state: 'error', text: e.message };
    });
  }

  /* A short label for a verdict, for the source list. */
  function label(v) {
    if (!v) return 'checking…';
    if (v.ok && !v.transcode) return 'direct play';
    if (v.ok) {
      /* Audio-only re-encoding is cheap and is the common case for a remux
         whose only track is TrueHD; a full re-encode is worth naming. */
      if (v.video && v.video !== 'transcode') return 'audio transcode';
      return 'server transcodes';
    }
    if (v.state === 'noaudio') return 'no passable audio';
    if (v.state === 'codec') return 'panel cannot decode';
    if (Media.isUHD(v.media)) return '4K, would transcode';
    if (v.state === 'nopart') return 'nothing to play';
    if (v.state === 'nometa') return 'no metadata';
    if (v.state === 'error') {
      /* The server answering with a refusal is a different problem from it not
         answering, and saying the wrong one sends you looking at the network. */
      var status = /-> (\d{3})/.exec(v.text || '');
      return status ? 'server said ' + status[1] : 'check failed';
    }
    return 'would transcode';
  }

  /* Why we are refusing, in full, for the message screen. */
  function refusal(item, v) {
    if (v.state === 'noaudio') {
      return ['No usable audio track', item.title + ' offers: ' + (v.text || 'nothing') +
        '.  Nothing there is both passable over plain HDMI ARC and actually the ' +
        'film — TrueHD and DTS-HD MA cannot pass at all, and a commentary is not ' +
        'what you asked to watch. Playing it would force an audio transcode on a ' +
        'server we do not own, so it is refused.'];
    }
    if (v.state === 'codec') {
      return ['This panel cannot decode it', item.title + ' is ' +
        (v.media && v.media.videoCodec) + ' in ' + (v.media && v.media.container) +
        '. The B8 decodes H.264 and HEVC in MKV, MP4 or MPEG-TS. Playing it ' +
        'would give a black screen, so it is refused before asking the server.'];
    }
    if (v.state === 'nopart') return ['Nothing to play', 'This copy has no playable part.'];
    if (v.state === 'nometa') return ['No metadata', 'The server returned nothing for this copy.'];
    if (v.state === 'error') return ['Could not check playback', v.text];

    var why = v.text || ('the server returned "' + v.state + '"');
    /* The only thing still refused outright. */
    return ['4K transcode refused', item.title + ' will not direct play — ' + why +
      '. Starting it would register a 4K transcode on the server, which gets ' +
      'killed mid-stream. Another copy may direct play — check the list. Or run ' +
      'probe.py against this file to find which declared capability flips it.'];
  }

  return { check: check, label: label, refusal: refusal };
})();
