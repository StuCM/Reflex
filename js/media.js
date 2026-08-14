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

  /* Can this track reach the amplifier untouched? TrueHD and DTS-HD MA cannot
     cross plain ARC at all, and anything the ranking does not know about is
     assumed not to. Says nothing about whether the track is worth playing —
     that is isCommentary's job. */
  function passesArc(st) {
    var codec = ((st && st.codec) || '').toLowerCase();
    var profile = ((st && st.profile) || '').toLowerCase();
    if (codec === 'truehd') return false;
    if ((codec === 'dca' || codec === 'dts') && profile.indexOf('ma') === 0) return false;
    return AUDIO_RANK[codec] !== undefined;
  }

  function audioScore(st) {
    var codec = (st.codec || '').toLowerCase();
    if (isCommentary(st)) return -1;
    if (!passesArc(st)) return -1;
    var rank = AUDIO_RANK[codec];
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

  function channelLabel(st) {
    return st.channels === 6 ? '5.1' : (st.channels === 8 ? '7.1' : (st.channels || '?') + '.0');
  }

  function audioLabel(st) {
    if (!st) return 'no passable track';
    var codec = (st.codec || '?').toUpperCase();
    var lang = st.languageCode ? ' ' + st.languageCode.toUpperCase() : '';
    return codec + ' ' + channelLabel(st) + lang;
  }

  /* The same track, named for a menu the user is reading rather than a badge
     they are glancing at: language first, because that is what they are
     choosing between, and the codec after, because that is what decides
     whether it passes over ARC. */
  function audioMenuLabel(st) {
    if (!st) return 'no passable track';
    return (langName(st) || 'Unknown') + ' · ' +
           (st.codec || '?').toUpperCase() + ' ' + channelLabel(st) +
           (isCommentary(st) ? ' · commentary' : '') +
           (passesArc(st) ? '' : ' · needs re-encoding');
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

  /* ---------- languages ----------

     Plex reports a stream's language as an ISO 639-2 code and, usually, a
     `language` field with the name already in it. Usually is not always, and
     "FRA" on a menu row is a worse answer than "French", so there is a table
     for the ones a shared library actually turns up. Anything unlisted falls
     back to the code, which is still better than nothing. */

  var LANGUAGES = {
    eng: 'English', fre: 'French', fra: 'French', ger: 'German', deu: 'German',
    spa: 'Spanish', ita: 'Italian', por: 'Portuguese', dut: 'Dutch', nld: 'Dutch',
    rus: 'Russian', pol: 'Polish', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish',
    fin: 'Finnish', ice: 'Icelandic', isl: 'Icelandic', gle: 'Irish', gla: 'Gaelic',
    cym: 'Welsh', wel: 'Welsh', cze: 'Czech', ces: 'Czech', hun: 'Hungarian',
    gre: 'Greek', ell: 'Greek', tur: 'Turkish', ara: 'Arabic', heb: 'Hebrew',
    hin: 'Hindi', ben: 'Bengali', tam: 'Tamil', tel: 'Telugu', urd: 'Urdu',
    jpn: 'Japanese', kor: 'Korean', chi: 'Chinese', zho: 'Chinese',
    tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', may: 'Malay',
    ukr: 'Ukrainian', ron: 'Romanian', rum: 'Romanian', bul: 'Bulgarian',
    hrv: 'Croatian', srp: 'Serbian', slo: 'Slovak', slk: 'Slovak', slv: 'Slovenian',
    cat: 'Catalan', baq: 'Basque', eus: 'Basque', glg: 'Galician',
    per: 'Persian', fas: 'Persian', fil: 'Filipino', tgl: 'Tagalog',
    und: 'Unknown', mul: 'Multiple', zxx: 'None'
  };

  function langName(st) {
    if (!st) return '';
    if (st.language) return st.language;
    var code = String(st.languageCode || st.languageTag || '').toLowerCase();
    if (!code) return '';
    return LANGUAGES[code] || code.toUpperCase();
  }

  /* ---------- subtitles ----------

     Two kinds, and the difference decides whether they can be shown at all.
     A text subtitle is a file of words: fetch it, parse it, draw it over the
     video, and the server does no work. An image subtitle (PGS on a Blu-ray
     remux, VOBSUB on a DVD rip) is a picture of words, and the only way to put
     it on screen is to have the server paint it into the video — which is a
     transcode, which on a 4K file is exactly what gets the session killed.

     So image tracks are listed and refused, with the reason, rather than
     quietly missing. */

  var TEXT_SUBS = { srt: 1, subrip: 1, ass: 1, ssa: 1, vtt: 1, webvtt: 1,
                    text: 1, mov_text: 1, subtitle: 1 };

  function isTextSub(st) {
    return !!(st && TEXT_SUBS[String(st.codec || '').toLowerCase()]);
  }

  function subtitleTracks(part) {
    var streams = (part && part.Stream) || [], out = [], i;
    for (i = 0; i < streams.length; i++) {
      if (streams[i].streamType === 3) out.push(streams[i]);
    }
    return out;
  }

  function subLabel(st) {
    if (!st) return 'Off';
    var name = langName(st) || 'Unknown';
    var bits = [];
    if (st.forced) bits.push('forced');
    if (isCommentary(st)) bits.push('commentary');
    if (st.hearingImpaired || /sdh/i.test(String(st.title || ''))) bits.push('SDH');
    if (!isTextSub(st)) bits.push(String(st.codec || '?').toUpperCase() + ', image');
    else if (st.title && String(st.title).length < 24) bits.push(String(st.title));
    return name + (bits.length ? ' · ' + bits.join(' · ') : '');
  }

  /* Which track to start with when the user asks for subtitles and has not
     said which: the one the file marks selected, else a plain forced track
     (a foreign-dialogue caption on an English film), else the first text one.
     Never an image track — it cannot be drawn — and never a commentary. */
  function pickSubtitle(part, languageCode) {
    var list = subtitleTracks(part), usable = [], i, st, want;
    for (i = 0; i < list.length; i++) {
      st = list[i];
      if (isTextSub(st) && !isCommentary(st)) usable.push(st);
    }
    if (!usable.length) return null;
    want = String(languageCode || '').toLowerCase();
    if (want) {
      for (i = 0; i < usable.length; i++) {
        if (String(usable[i].languageCode || '').toLowerCase() === want) return usable[i];
      }
    }
    for (i = 0; i < usable.length; i++) if (usable[i].selected) return usable[i];
    for (i = 0; i < usable.length; i++) if (usable[i].forced) return usable[i];
    return usable[0];
  }

  /* ---------- markers and chapters ----------

     Plex analyses a film for an intro and an end-credits sequence and reports
     them as Marker entries in milliseconds. That is where "Skip intro" comes
     from — there is nothing to detect client side, only something to offer at
     the right moment. Chapters are the same shape and are what the trackbar's
     ticks are drawn from. */

  function markerAt(item, seconds) {
    var list = (item && item.Marker) || [], t = seconds * 1000, i, m;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (t >= (m.startTimeOffset || 0) && t < (m.endTimeOffset || 0)) return m;
    }
    return null;
  }

  function markerLabel(m) {
    var type = String((m && m.type) || '').toLowerCase();
    if (type === 'intro') return 'Skip intro';
    if (type === 'credits') return 'Skip credits';
    if (type === 'commercial') return 'Skip ad break';
    return 'Skip';
  }

  /* [{ title, start, end }] in seconds, in order. Both Marker and Chapter use
     the same offsets, so the trackbar can draw either. */
  function chapters(item) {
    var list = (item && item.Chapter) || [], out = [], i, c;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      out.push({
        title: c.tag || c.title || ('Chapter ' + (c.index || i + 1)),
        start: (c.startTimeOffset || 0) / 1000,
        end: (c.endTimeOffset || 0) / 1000
      });
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /* ---------- quality ----------

     Plex's quality menu is a cap on the video bitrate, which the server obeys
     by re-encoding. So every entry below "Original" is a transcode by
     definition — which means the 4K rule applies to all of them, and on a 4K
     file the guard will refuse every one. That is correct and is left to the
     guard rather than hidden here, so the refusal explains itself.

     Only caps below what the file already is are offered; capping a 9 Mbps
     file at 20 would make the server work for a worse picture. */

  var BITRATES = [20000, 12000, 8000, 4000, 3000, 2000, 720];

  function bitrateLabel(kbps) {
    return kbps >= 1000 ? (kbps / 1000) + ' Mbps' : kbps + ' Kbps';
  }

  function versionLabel(media) {
    if (!media) return 'this version';
    var res = String(media.videoResolution || '').toLowerCase();
    var name = res === '4k' ? '4K' : (res ? res + 'p' : (media.height || '?') + 'p');
    var out = name + ' ' + String(media.videoCodec || '?').toUpperCase();
    if (media.bitrate) out += ' · ' + bitrateLabel(media.bitrate);
    return out;
  }

  /* [{ label, bitrate }] — bitrate null means the file as it is. */
  function qualities(media) {
    var source = (media && media.bitrate) || 0, out = [], i;
    out.push({ label: 'Original (' + versionLabel(media) + ')', bitrate: null });
    for (i = 0; i < BITRATES.length; i++) {
      if (!source || BITRATES[i] < source) {
        out.push({ label: bitrateLabel(BITRATES[i]) + ' — server converts',
                   bitrate: BITRATES[i] });
      }
    }
    return out;
  }

  /* ---------- what the panel can actually decode ----------

     The same list js/plex.js declares to the server, checked again here because
     we identify as Chrome (see the header comment there for why). A server
     applying its Chrome profile may offer direct play of something Chrome can
     decode and this panel cannot — VP9 or AV1 in a WebM, say — and claiming a
     codec the panel cannot decode gives a black screen. */

  function canDecode(media) {
    if (!media) return false;
    /* Whatever we declared to the server, checked again on the way back — the
       two must agree or a widened profile turns into a black screen. */
    return Panel.supports('video', media.videoCodec) &&
           Panel.supports('container', media.container);
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

  /* An episode is identified by which show it belongs to and where it sits in
     it. Episodes often carry no external ids of their own, and their titles are
     not unique across shows — "Pilot" is everywhere — so season and episode
     number against the show's identity is what actually holds. */
  function episodeKey(item) {
    var show = String(item.grandparentGuid || item.grandparentTitle || '')
      .toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9:/.]+/g, '');
    var season = item.parentIndex === undefined ? '?' : item.parentIndex;
    var number = item.index === undefined ? '?' : item.index;
    return 'episode://' + show + '/' + season + '/' + number;
  }

  /* Every key this item could be recognised by, best first. */
  function identities(item) {
    var out = externalIds(item);
    var guid = String((item && item.guid) || '');
    if (guid.indexOf('plex://') === 0) out.push(guid.toLowerCase());
    if (item && item.type === 'episode') {
      out.push(episodeKey(item));
      return out;
    }
    out.push(titleKey(item));
    return out;
  }

  /* "Adventure Time · S2E7" — an episode's title alone says nothing. */
  function episodeLabel(item) {
    if (!item || item.type !== 'episode') return '';
    var s = item.parentIndex, e = item.index;
    if (s === undefined && e === undefined) return item.grandparentTitle || '';
    return (item.grandparentTitle || '') +
           '  ·  S' + (s === undefined ? '?' : s) +
           'E' + (e === undefined ? '?' : (e < 10 ? '0' + e : e));
  }

  /* One stable key, for caching and for saying "this film" in a log line. */
  function identity(item) { return identities(item)[0]; }

  return {
    pickAudio: pickAudio, audioLabel: audioLabel, isUHD: isUHD, canDecode: canDecode,
    audioMenuLabel: audioMenuLabel, passesArc: passesArc,
    isCommentary: isCommentary, audioSummary: audioSummary, bestAudio: bestAudio,
    audioTracks: audioTracks, streamById: streamById,
    allows: allows,
    langName: langName, isTextSub: isTextSub, subtitleTracks: subtitleTracks,
    subLabel: subLabel, pickSubtitle: pickSubtitle,
    markerAt: markerAt, markerLabel: markerLabel, chapters: chapters,
    versionLabel: versionLabel, qualities: qualities, bitrateLabel: bitrateLabel,
    ageLimit: ageLimit, isKidsRating: isKidsRating, KIDS_MAX_AGE: KIDS_MAX_AGE,
    identities: identities, identity: identity, episodeLabel: episodeLabel
  };
})();

if (typeof module !== 'undefined') module.exports = Media;   // for the unit tests
