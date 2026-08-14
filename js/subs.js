/* Subtitles, as text over the video.

   Burning subtitles into the picture is a transcode, and a transcode of a 4K
   file is the one thing that gets a session killed on a server we do not own.
   So they are never burned in: the text track is fetched as an ordinary file,
   parsed here, and drawn in a div over the video element. That costs the
   server one small GET and nothing else, and it works identically whether the
   film is direct playing or being converted.

   Pure: text in, cues out. No network, no DOM — js/plex.js fetches, js/player.js
   draws, and this decides what the words are. Unit tested in test/subs.test.js.

   Handles SRT and WebVTT, which are the two things a Plex server hands back
   for a text subtitle stream. They differ in the decimal separator and a header
   line, and nothing else that matters here. */
var Subs = (function () {
  'use strict';

  /* '01:23:45,678', '01:23:45.678' and '23:45.67' all appear in the wild. */
  function seconds(stamp) {
    var m = String(stamp).match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/);
    if (!m) return null;
    var frac = m[4] ? parseInt(m[4], 10) / Math.pow(10, m[4].length) : 0;
    return (m[1] ? parseInt(m[1], 10) : 0) * 3600 +
           parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + frac;
  }

  /* Markup a TV has no business rendering: SRT's HTML-ish tags, ASS override
     blocks that survive a conversion, and the position hints WebVTT puts after
     the timestamp. Plain text is what the overlay draws. */
  function strip(line) {
    return line.replace(/<[^>]*>/g, '')
               .replace(/\{\\[^}]*\}/g, '')
               .replace(/\s+$/, '');
  }

  /* Cues, in time order: [{ start, end, text }] in seconds. */
  function parse(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var cues = [], i, arrow, start, end, body, line;

    for (i = 0; i < lines.length; i++) {
      arrow = lines[i].indexOf('-->');
      if (arrow < 0) continue;
      start = seconds(lines[i].substring(0, arrow));
      end = seconds(lines[i].substring(arrow + 3));
      if (start === null || end === null) continue;

      body = [];
      for (i++; i < lines.length; i++) {
        line = lines[i];
        if (line.replace(/\s/g, '') === '') break;
        /* A cue number on its own line belongs to the NEXT cue, so stop before
           swallowing it — otherwise every cue ends with a stray digit. */
        if (/^\d+$/.test(line.trim()) && lines[i + 1] &&
            lines[i + 1].indexOf('-->') >= 0) { i--; break; }
        line = strip(line);
        if (line !== '') body.push(line);
      }
      if (body.length) cues.push({ start: start, end: end, text: body.join('\n') });
    }

    cues.sort(function (a, b) { return a.start - b.start; });
    return cues;
  }

  /* First cue index starting after t. Binary, because a two-hour film has a
     couple of thousand cues and this runs on every timeupdate. */
  function after(cues, t) {
    var lo = 0, hi = cues.length, mid;
    while (lo < hi) {
      mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /* What should be on screen at t, or '' for nothing. Cues overlap — two
     speakers, or a sign translated over dialogue — so this collects every one
     still open rather than the newest. */
  var OVERLAP = 12;                     // how far back an open cue can start

  function textAt(cues, t) {
    if (!cues || !cues.length) return '';
    var out = [], i = after(cues, t), stop = Math.max(0, i - OVERLAP), j;
    for (j = i - 1; j >= stop; j--) {
      if (cues[j].end > t) out.unshift(cues[j].text);
    }
    return out.join('\n');
  }

  return { parse: parse, textAt: textAt, seconds: seconds };
})();

if (typeof module !== 'undefined') module.exports = Subs;   // for the unit tests
