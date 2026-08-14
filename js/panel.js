/* What this panel will actually play, asked of the panel itself.

   Codec support is a property of the hardware, but Plex cannot see the
   hardware — it only knows what the client declares in
   X-Plex-Client-Profile-Extra, and then transcodes anything outside it. So a
   narrow declaration means the server re-encodes films the B8 would have
   played untouched, on hardware we do not own.

   CLAUDE.md's rule cuts both ways: claiming a codec the panel cannot decode
   gives a black screen, and omitting one it can pushes needless load onto
   someone else's server. The way out of guessing is to ask: canPlayType is the
   only capability API a WAM app has, and on webOS it is answered by the same
   media pipeline that does the decoding.

   It is a claim, not a proof — "probably" from a TV is a strong hint and
   nothing more. So: the baseline below is what we already know works and is
   never removed by a probe, and anything else is only added when the panel says
   "probably". Press the `panel` chip to see what it actually answered. */
var Panel = (function () {
  'use strict';

  /* Known good on a B8, and the profile that was already shipping. A probe can
     add to this; it can never take anything away, because a TV that answers ""
     for a type it plays perfectly well is a common enough thing. */
  var BASE = {
    container: { mkv: true, mp4: true, mpegts: true },
    video: { h264: true, hevc: true },
    audio: { aac: true, ac3: true, eac3: true, mp3: true }
  };

  /* Candidates worth asking about, each with the mime the pipeline understands.
     Nothing here is claimed unless the answer comes back "probably". */
  var CANDIDATES = [
    { kind: 'video', name: 'vp9',   mime: 'video/webm; codecs="vp9"' },
    { kind: 'video', name: 'vp8',   mime: 'video/webm; codecs="vp8"' },
    { kind: 'video', name: 'av1',   mime: 'video/mp4; codecs="av01.0.05M.08"' },
    { kind: 'video', name: 'mpeg2video', mime: 'video/mpeg' },
    { kind: 'video', name: 'vc1',   mime: 'video/x-ms-wmv' },
    { kind: 'video', name: 'mpeg4', mime: 'video/mp4; codecs="mp4v.20.8"' },

    { kind: 'container', name: 'webm', mime: 'video/webm' },
    { kind: 'container', name: 'avi',  mime: 'video/x-msvideo' },
    { kind: 'container', name: 'mov',  mime: 'video/quicktime' },
    { kind: 'container', name: 'asf',  mime: 'video/x-ms-asf' },

    /* Audio is asked about for the report only — what the panel can decode is a
       different question from what survives HDMI ARC, and js/media.js owns
       that one. */
    { kind: 'audio', name: 'flac',   mime: 'audio/flac' },
    { kind: 'audio', name: 'opus',   mime: 'audio/ogg; codecs="opus"' },
    { kind: 'audio', name: 'vorbis', mime: 'audio/ogg; codecs="vorbis"' },
    { kind: 'audio', name: 'dts',    mime: 'audio/vnd.dts' },
    { kind: 'audio', name: 'truehd', mime: 'audio/true-hd' }
  ];

  var answers = null;          // [{ kind, name, mime, said }]
  var caps = null;             // BASE plus whatever the probe added
  var features = null;         // what the media element exposes beyond src/play

  function ask(mime) {
    var el = document.getElementById('video');
    if (!el || !el.canPlayType) return '';
    try { return el.canPlayType(mime) || ''; } catch (e) { return ''; }
  }

  function probe() {
    if (answers) return answers;
    answers = [];
    caps = {
      container: {}, video: {}, audio: {}
    };
    var kinds = ['container', 'video', 'audio'], i, k;
    for (i = 0; i < kinds.length; i++) {
      k = kinds[i];
      var keys = Object.keys(BASE[k]), n;
      for (n = 0; n < keys.length; n++) caps[k][keys[n]] = true;
    }

    for (i = 0; i < CANDIDATES.length; i++) {
      var c = CANDIDATES[i];
      var said = ask(c.mime);
      answers.push({ kind: c.kind, name: c.name, mime: c.mime, said: said });
      /* "maybe" is what a TV says when it has not been asked precisely enough,
         and acting on it is how you get a black screen. */
      if (said === 'probably' && c.kind !== 'audio') caps[c.kind][c.name] = true;
    }
    return answers;
  }

  /* What the pipeline offers past the basics. On webOS a <video> element is not
     the browser decoding — WAM hands playback to the TV's own media pipeline,
     the same hardware decoder the built-in player uses, which is why 4K HEVC
     direct plays here and fails in a desktop browser. So the question is not
     whether to replace <video> with a native player; it is what this pipeline
     already exposes that we are not using.

     audioTracks is the one that matters most: with it, switching audio is a
     client-side selection, and without it the only honest way is to ask the
     server for that track and restart, which is what the player does today. */
  function probeFeatures() {
    if (features) return features;
    var el = document.getElementById('video');
    function has(name) { return !!(el && name in el); }
    features = {
      audioTracks: has('audioTracks') ? String((el.audioTracks || {}).length) : 'no',
      videoTracks: has('videoTracks') ? 'yes' : 'no',
      textTracks: has('textTracks') ? 'yes' : 'no',
      playbackQuality: !!(el && (el.getVideoPlaybackQuality ||
                                 el.webkitDecodedFrameCount !== undefined)),
      mediaSource: (typeof window !== 'undefined' && !!window.MediaSource),
      webOS: (typeof window !== 'undefined' && !!window.webOS),
      webOSVersion: (typeof window !== 'undefined' && window.webOS &&
                     window.webOS.device && window.webOS.device.platformVersion) || '?'
    };
    return features;
  }

  function supports(kind, name) {
    if (!caps) probe();
    return caps[kind][String(name || '').toLowerCase()] === true;
  }

  function list(kind) {
    if (!caps) probe();
    return Object.keys(caps[kind]);
  }

  /* The declaration Plex is given. Built from what the panel claims rather than
     from a constant, so widening support is a matter of the panel answering
     differently — not of editing a string and hoping. */
  function clientProfile() {
    if (!caps) probe();
    var containers = list('container'), video = list('video').join(','), audio = list('audio').join(',');
    var out = [], i;
    for (i = 0; i < containers.length; i++) {
      out.push('add-direct-play-profile(type=videoProfile&container=' + containers[i] +
               '&codec=' + video + '&audioCodec=' + audio + ')');
    }
    /* The two limits that are about this panel rather than about codecs: H.264
       above level 5.1 and HEVC above 10-bit are beyond it. */
    out.push('add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&isRequired=false)');
    out.push('add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10&isRequired=false)');
    return out.join('+');
  }

  /* For the panel chip: what was asked and what came back, so widening is a
     decision made on evidence. */
  function report() {
    var rows = probe(), lines = [], kinds = ['video', 'container', 'audio'], i, k, said;
    lines.push('DECLARED TO THE SERVER');
    lines.push('containers   ' + list('container').join(', '));
    lines.push('video        ' + list('video').join(', '));
    lines.push('audio        ' + list('audio').join(', '));
    lines.push('');
    lines.push('PANEL ANSWERED  (only "probably" is acted on)');
    for (k = 0; k < kinds.length; k++) {
      said = [];
      for (i = 0; i < rows.length; i++) {
        if (rows[i].kind === kinds[k]) said.push(rows[i].name + '=' + (rows[i].said || 'no'));
      }
      lines.push(kinds[k] + (kinds[k] === 'video' ? '        ' : (kinds[k] === 'audio' ? '        ' : '    ')) +
                 said.join('  '));
    }
    var f = probeFeatures();
    lines.push('');
    lines.push('PIPELINE');
    lines.push('audioTracks  ' + f.audioTracks + '    textTracks ' + f.textTracks +
               '    MediaSource ' + (f.mediaSource ? 'yes' : 'no'));
    lines.push('webOS ' + (f.webOS ? f.webOSVersion : 'no') +
               '    frame stats ' + (f.playbackQuality ? 'yes' : 'no'));
    lines.push('');
    lines.push('Audio over ARC is a separate question: TrueHD and DTS-HD MA never');
    lines.push('pass, whatever the panel decodes.');
    return lines.join('\n');
  }

  return { probe: probe, supports: supports, list: list, features: probeFeatures,
           clientProfile: clientProfile, report: report };
})();
