/* Will this copy play, and at what cost to someone else's server?

   The rule the whole app exists to keep: nothing opens a session on a server we
   do not own unless we already know it will direct play. Two checks, in this
   order, because the first is free:

     1. Is there an audio track that can pass over plain HDMI ARC at all? A file
        offering only TrueHD or DTS-HD MA is refused here, without a request.
     2. Does the server agree it will direct play, with that track chosen? Asked
        with hasMDE=1, which returns the verdict WITHOUT opening a session.

   Every copy on every server goes through this, which is what lets the detail
   page say "this one plays, that one doesn't" before you choose. */
var Guard = (function () {
  'use strict';

  /* Resolves with a verdict object, never rejects:
       { ok, state, audio, media, part, md, text }
     state is one of: 'directplay' | 'noaudio' | 'nopart' | 'nometa' |
                      'transcode' (or whatever else the server said) | 'error' */
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

      /* Free and certain, so it goes before anything that costs a request. */
      if (!Media.canDecode(media)) {
        return { ok: false, state: 'codec', md: md, media: media, part: part, mediaIndex: n,
                 text: (media.videoCodec || '?') + ' in ' + (media.container || '?') +
                       ' is not something this panel decodes.' };
      }

      var audio = Media.pickAudio(part);
      if (!audio) {
        return { ok: false, state: 'noaudio', md: md, media: media, part: part,
                 mediaIndex: n, audio: null,
                 text: 'Only TrueHD or DTS-HD MA, neither of which passes over plain ARC.' };
      }

      var server = Servers.of(md);
      return Plex.decide(server, md, n, 0, audio.id).then(function (v) {
        UI.debug('decision: ' + v.decision + ' · ' + md.title +
                 (Servers.count() > 1 ? ' on ' + server.name : '') +
                 ' · ' + Media.audioLabel(audio) + ' ' + v.text);
        return {
          ok: v.decision === 'directplay',
          state: v.decision,
          audio: audio, md: md, media: media, part: part, mediaIndex: n,
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
    if (v.ok) return 'direct play';
    if (v.state === 'noaudio') return 'no passable audio';
    if (v.state === 'codec') return 'panel cannot decode';
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
      return ['No passable audio track', item.title +
        ' only offers TrueHD or DTS-HD MA. Neither can pass over plain HDMI ARC ' +
        'on this set, so playing it would force an audio transcode on a server ' +
        'we do not own. Refused.'];
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
    if (Media.isUHD(v.media)) {
      return ['4K transcode refused', item.title + ' will not direct play — ' + why +
        '. Starting it would register a 4K transcode on the server, which gets killed. ' +
        'Run probe.py against this file to find which declared capability flips it.'];
    }
    return ['Would transcode', item.title + ' will not direct play — ' + why +
      '. Reflex plays direct only.'];
  }

  return { check: check, label: label, refusal: refusal };
})();
