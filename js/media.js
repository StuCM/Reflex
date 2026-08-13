/* The rules that decide what we are willing to play, and what counts as a kids
   film. Pure functions over Plex metadata — no network, no DOM, no state.

   These live apart from js/plex.js on purpose. They are the parts of the app
   that must not be wrong: picking the wrong audio track puts a transcode on a
   server we do not own, and misreading a certificate puts an 18 in front of a
   child. Being pure, they are also the only parts that unit test cleanly —
   see test/audio.test.js and test/rating.test.js. */
var Media = (function () {
  'use strict';

  /* ---------- audio ----------

     ARC (not eARC) on a 2018 set. TrueHD and DTS-HD MA can never pass; plain
     DTS is a coin flip on this generation, so it sits below AAC. See CLAUDE.md. */

  var AUDIO_RANK = { eac3: 5, 'ec-3': 5, ac3: 4, aac: 3, mp3: 2, dca: 1, dts: 1 };

  function audioScore(st) {
    var codec = (st.codec || '').toLowerCase();
    var profile = (st.profile || '').toLowerCase();
    if (codec === 'truehd') return -1;
    if ((codec === 'dca' || codec === 'dts') && profile.indexOf('ma') === 0) return -1;
    var rank = AUDIO_RANK[codec];
    if (rank === undefined) return -1;
    var ch = st.channels || 2, bonus;
    if (rank >= 4) bonus = Math.min(ch, 6);          // AC3/E-AC3: 5.1 preferred
    else bonus = (ch <= 2 ? 6 : 1);                  // AAC and below: stereo preferred
    return rank * 100 + bonus * 2 + (st.selected ? 1 : 0);
  }

  /* Returns the best passable audio stream on a part, or null if every track
     would force an audio transcode. */
  function pickAudio(part) {
    var streams = (part && part.Stream) || [], best = null, bestScore = -1, i, sc;
    for (i = 0; i < streams.length; i++) {
      if (streams[i].streamType !== 2) continue;
      sc = audioScore(streams[i]);
      if (sc > bestScore) { bestScore = sc; best = streams[i]; }
    }
    return bestScore < 0 ? null : best;
  }

  function audioLabel(st) {
    if (!st) return 'no passable track';
    var codec = (st.codec || '?').toUpperCase();
    var ch = st.channels === 6 ? '5.1' : (st.channels === 8 ? '7.1' : (st.channels || '?') + '.0');
    var lang = st.languageCode ? ' ' + st.languageCode.toUpperCase() : '';
    return codec + ' ' + ch + lang;
  }

  /* ---------- resolution ---------- */

  function isUHD(media) {
    return ((media && media.width) || 0) >= 2500 || ((media && media.height) || 0) >= 1400;
  }

  /* ---------- certificates ---------- */

  var RATING_AGE = {
    u: 0, g: 0, e: 0, ec: 0, 'tv-y': 0, 'tv-g': 0, uc: 0,
    'tv-y7': 7, pg: 8, 'tv-pg': 8,
    'pg-13': 13, 'tv-14': 14,
    r: 17, 'tv-ma': 17, 'nc-17': 18, x: 18
  };

  /* Minimum age a certificate implies, or null if unrated/unrecognised.
     Unrated returns null rather than 0 — absence of a rating is not evidence
     that something is suitable for children. */
  function ageLimit(rating) {
    if (!rating) return null;
    var r = String(rating).toLowerCase().replace(/\s/g, '');
    var slash = r.lastIndexOf('/');
    if (slash >= 0) r = r.substring(slash + 1);      // strip "gb/", "us/"
    var m = r.match(/^(\d{1,2})/);                    // 12, 12a, 15, 18, 6, 7
    if (m) return parseInt(m[1], 10);
    return RATING_AGE[r] === undefined ? null : RATING_AGE[r];
  }

  /* Everything rated at or below this counts as kids viewing. */
  var KIDS_MAX_AGE = 12;

  function isKidsRating(rating) {
    var age = ageLimit(rating);
    return age !== null && age <= KIDS_MAX_AGE;
  }

  return {
    pickAudio: pickAudio, audioLabel: audioLabel, isUHD: isUHD,
    ageLimit: ageLimit, isKidsRating: isKidsRating, KIDS_MAX_AGE: KIDS_MAX_AGE
  };
})();
