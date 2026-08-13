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

  /* A director's commentary is a perfectly good AC3 5.1 by every measure this
     ranking uses, and picking it ruins the film. It is also exactly what gets
     picked on a remux whose main track is TrueHD, because excluding the TrueHD
     leaves the commentary as the only passable thing on the file.

     Plex puts the word in the stream's title rather than flagging it, so this
     is a text match — deliberately broad, because being wrong in the other
     direction means two hours of someone talking over the film. */
  var NOT_THE_FILM =
    /commentar|descriptive|description|narrat|audio ?desc|\bdvs\b|\bad\b sign|karaoke/i;

  function isCommentary(st) {
    if (!st) return false;
    var text = [st.title, st.displayTitle, st.extendedDisplayTitle].join(' ');
    return NOT_THE_FILM.test(text);
  }

  function audioScore(st) {
    var codec = (st.codec || '').toLowerCase();
    var profile = (st.profile || '').toLowerCase();
    if (isCommentary(st)) return -1;
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

  /* The best track when nothing passes — the film's own audio, transcoded.
     Still never a commentary: that is about playing the right thing, not about
     what the link can carry. Channel count wins here because the server is
     going to re-encode it anyway, so we may as well start from the good one. */
  function bestAudio(part) {
    var streams = (part && part.Stream) || [], best = null, bestScore = -1, i, st, sc;
    for (i = 0; i < streams.length; i++) {
      st = streams[i];
      if (st.streamType !== 2 || isCommentary(st)) continue;
      sc = Math.min(st.channels || 2, 8) * 10 + (st.selected ? 5 : 0) +
           (st.default ? 2 : 0);
      if (sc > bestScore) { bestScore = sc; best = st; }
    }
    return best;
  }

  function audioLabel(st) {
    if (!st) return 'no passable track';
    var codec = (st.codec || '?').toUpperCase();
    var ch = st.channels === 6 ? '5.1' : (st.channels === 8 ? '7.1' : (st.channels || '?') + '.0');
    var lang = st.languageCode ? ' ' + st.languageCode.toUpperCase() : '';
    return codec + ' ' + ch + lang;
  }

  /* Every audio track on a part, in file order — what the player cycles
     through. */
  function audioTracks(part) {
    var streams = (part && part.Stream) || [], out = [], i;
    for (i = 0; i < streams.length; i++) {
      if (streams[i].streamType === 2) out.push(streams[i]);
    }
    return out;
  }

  function streamById(part, id) {
    var list = (part && part.Stream) || [], i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /* What the file actually offers, for a refusal that says something useful.
     "only TrueHD or DTS-HD MA" was a lie the moment commentary tracks started
     being excluded too. */
  function audioSummary(part) {
    var streams = (part && part.Stream) || [], out = [], i, st;
    for (i = 0; i < streams.length; i++) {
      st = streams[i];
      if (st.streamType !== 2) continue;
      out.push(audioLabel(st) + (isCommentary(st) ? ' (commentary)' : ''));
    }
    return out.join(', ') || 'no audio tracks at all';
  }

  /* ---------- what the panel can actually decode ----------

     The same list js/plex.js declares to the server, checked again here because
     we identify as Chrome (see the header comment there for why). A server
     applying its Chrome profile may offer direct play of something Chrome can
     decode and this panel cannot — VP9 or AV1 in a WebM, say — and claiming a
     codec the panel cannot decode gives a black screen. */

  var PANEL_VIDEO = { h264: true, hevc: true };
  var PANEL_CONTAINER = { mkv: true, mp4: true, mpegts: true };

  function canDecode(media) {
    if (!media) return false;
    var codec = String(media.videoCodec || '').toLowerCase();
    var container = String(media.container || '').toLowerCase();
    return PANEL_VIDEO[codec] === true && PANEL_CONTAINER[container] === true;
  }

  /* ---------- resolution ---------- */

  function isUHD(media) {
    return ((media && media.width) || 0) >= 2500 || ((media && media.height) || 0) >= 1400;
  }

  /* Will we play this, given what the server said?

     The one rule with teeth: the admin's kill-stream fires on 4K transcodes,
     after the session has started, so a 4K item that will not direct play is
     refused before anything opens. Below 4K a transcode is ordinary server
     work — preferring direct play is right, insisting on it is what made every
     TrueHD remux unplayable.

     Direct play is also the only path that hands the panel the original file,
     so that is where the decode check applies; a re-encode arrives as H.264. */
  function allows(media, direct) {
    return direct ? canDecode(media) : !isUHD(media);
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

  /* ---------- identity ----------

     Is this the same film as that one, on a different server?

     Plex itself answers this every time it syncs a watch position between the
     two servers, and it does it by matching the item's global identifiers. So
     do we. Every id an item carries is a candidate key, and two items are the
     same film if they agree on *any* of them — servers running different agent
     versions expose different subsets, and requiring them all to line up would
     mean silently showing duplicates.

     Title and year come last, and only as a fallback. Two genuinely different
     films sharing both is rare enough to accept; the same film failing to
     match because one server has no external id is not. */

  function externalIds(item) {
    var out = [], g = (item && item.Guid) || [], i, id;
    for (i = 0; i < g.length; i++) {
      id = String(g[i].id || '').toLowerCase();
      if (id.indexOf('imdb://') === 0 || id.indexOf('tmdb://') === 0 ||
          id.indexOf('tvdb://') === 0) out.push(id);
    }
    /* The legacy agent form: com.plexapp.agents.imdb://tt0133093?lang=en */
    var legacy = String((item && item.guid) || '');
    var m = legacy.match(/agents\.(imdb|themoviedb|thetvdb):\/\/([^?/]+)/);
    if (m) {
      out.push((m[1] === 'themoviedb' ? 'tmdb' : (m[1] === 'thetvdb' ? 'tvdb' : 'imdb')) +
               '://' + m[2].toLowerCase());
    }
    return out;
  }

  function titleKey(item) {
    var t = String((item && (item.titleSort || item.title)) || '').toLowerCase()
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, '');
    return 'title://' + t + '/' + ((item && item.year) || '');
  }

  /* Every key this item could be recognised by, best first. */
  function identities(item) {
    var out = externalIds(item);
    var guid = String((item && item.guid) || '');
    if (guid.indexOf('plex://') === 0) out.push(guid.toLowerCase());
    out.push(titleKey(item));
    return out;
  }

  /* One stable key, for caching and for saying "this film" in a log line. */
  function identity(item) { return identities(item)[0]; }

  return {
    pickAudio: pickAudio, audioLabel: audioLabel, isUHD: isUHD, canDecode: canDecode,
    isCommentary: isCommentary, audioSummary: audioSummary, bestAudio: bestAudio,
    audioTracks: audioTracks, streamById: streamById,
    allows: allows,
    ageLimit: ageLimit, isKidsRating: isKidsRating, KIDS_MAX_AGE: KIDS_MAX_AGE,
    identities: identities, identity: identity
  };
})();

if (typeof module !== 'undefined') module.exports = Media;   // for the unit tests
