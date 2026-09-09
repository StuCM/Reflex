/* Settings that differ between the TV and a laptop, in one place. Loaded first.

   On the TV nothing overrides these, so the defaults are what ships. The dev
   server injects window.REFLEX_CONFIG before this file runs, which is the only
   seam the app needs to talk to a fake server instead of a real one. */
var Config = (function () {
  'use strict';

  const cfg = {
    /* plex.tv itself, unless something is standing in for it. */
    plexTvBase: 'https://plex.tv',

    /* Free TMDB v3 API key. Empty means the discovery rows don't appear and
       the artwork stays whatever Plex has; nothing else is affected. */
    tmdbKey: '',

    /* The Discovery page, in the order they appear on screen. `kind` is what
       js/tmdb.js dispatches on; a genre id comes from TMDB's
       /genre/movie/list and a provider id from JustWatch as TMDB exposes it. */
    categories: [
      { title: 'Trending this week', kind: 'trending' },
      { title: 'On Netflix',         kind: 'provider', id: 8 },
      { title: 'On Prime Video',     kind: 'provider', id: 9 },
      { title: 'Science fiction',    kind: 'genre',    id: 878 },
      { title: 'Because of what you have been watching', kind: 'recommended' }
    ],

    /* TMDB's API and its image CDN, unless something is standing in for them. */
    tmdbBase: 'https://api.themoviedb.org/3',
    tmdbImageBase: 'https://image.tmdb.org/t/p/',

    /* Free YouTube Data API v3 key, for the season recaps on a show page. Empty
       means the Find recaps action does not appear; nothing else is affected. */
    youtubeKey: '',

    /* YouTube's API and its embed player, unless something is standing in. */
    youtubeBase: 'https://www.googleapis.com/youtube/v3',
    youtubeEmbedBase: 'https://www.youtube.com/embed/',

    /* Bring-up only: WAM doesn't forward console.log anywhere readable on this
       set, so the app can POST its debug line to a listener on the dev machine.
       Empty switches it off. Set it to e.g. 'http://192.168.1.92:8099/' while
       working on the TV — see `npm run beacon`. */
    beacon: '',

    /* True only under the dev server. Nothing should behave differently because
       of it; it exists so the debug line can say where it is running. */
    dev: false
  };

  const over = (typeof window !== 'undefined' && window.REFLEX_CONFIG) || null;
  if (over) {
    const keys = Object.keys(over);
    for (let i = 0; i < keys.length; i++) cfg[keys[i]] = over[keys[i]];
  }
  return cfg;
})();
/* One XHR, for every client that talks to something.

   Plex, TMDB and YouTube each grew their own copy of the same forty lines —
   open, timeout, status check, parse, three error paths — and the copies had
   started to drift. They differ in three things only, and those are the
   options: the headers to send, the name to put in an error, and whether a
   body that is not JSON is an answer or a failure.

   No fetch(): Chromium 53 has it, but not with the timeout this needs, and a
   request to a server on the other side of the country that never returns is
   worse than one that fails. */
var Http = (function () {
  'use strict';

  /* Encode an object as a query string, dropping anything null or undefined —
     Plex reads an empty parameter as a value, not as an omission. */
  function qs(params) {
    const keys = Object.keys(params);
    const parts = [];
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
    }
    return parts.join('&');
  }

  /* opts: method, headers, timeout, body, label (what an error calls this),
     text (resolve a non-JSON body instead of rejecting), explain (add the
     server's own reason to a failure). */
  function request(url, opts) {
    opts = opts || {};
    const label = opts.label || url;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(opts.method || 'GET', url, true);
      xhr.timeout = opts.timeout || 15000;
      const h = opts.headers || {};
      const keys = Object.keys(h);
      for (let i = 0; i < keys.length; i++) xhr.setRequestHeader(keys[i], h[keys[i]]);
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(label + ' -> ' + xhr.status + (opts.explain ? opts.explain(xhr) : '')));
          return;
        }
        if (!xhr.responseText) { resolve(null); return; }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) {
          if (opts.text) resolve(xhr.responseText);
          else reject(new Error(label + ' bad json'));
        }
      };
      xhr.ontimeout = () => { reject(new Error(label + ' timeout')); };
      xhr.onerror = () => { reject(new Error(label + ' network')); };
      xhr.send(opts.body || null);
    });
  }

  return { qs: qs, request: request };
})();
/* IndexedDB key/value cache. One store, string keys:
     sections            -> [{key,title,type}]
     items:<sectionKey>  -> [item, ...]
     meta:<ratingKey>    -> full /library/metadata payload
   ponytail: one object store, whole-section blobs. A section is a few hundred
   KB; splitting into pages buys nothing until libraries get much bigger. */
var Store = (function () {
  'use strict';

  const NAME = 'reflex';
  const STORE = 'kv';
  let dbp = null;
  const mem = {};          // fallback if IndexedDB is unavailable or blocked

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => { resolve(req.result); };
      req.onerror = () => { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => {
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => { resolve(out.result); };
        t.onerror = () => { reject(t.error); };
      });
    });
  }

  function get(key) {
    return tx('readonly', (s) => { return s.get(key); })
      .catch(() => { return mem[key]; });
  }

  function put(key, value) {
    mem[key] = value;
    return tx('readwrite', (s) => { return s.put(value, key); })
      .catch(() => { return null; });
  }

  return { get: get, put: put };
})();
/* Everything the app caches, in one list.

   js/store.js is a key/value store and knows nothing about what it holds.
   Before this, seven files built their own key strings, three invented their
   own way of stamping an entry with a time, and Continue watching was dropped
   by writing null into a row — a convention nothing else knew about. What is
   cached, under what key, and how long a hit is good for is one question, so
   it is answered here.

   Three ways a thing can go stale, and they are different enough to name:
   `kept` until something replaces it, `daily` on a clock, and `misses` — a hit
   kept for ever while a miss is retried after a while, which is what a lookup
   against a library that may yet gain the film needs. */
var Cached = (function () {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;

  /* Cached until it is replaced. drop() writes null rather than deleting:
     Store is get and put, and a null reads back as a miss. */
  function kept(prefix) {
    return {
      get: (id) => Store.get(prefix + (id === undefined ? '' : id)),
      put: (id, value) => Store.put(prefix + (id === undefined ? '' : id), value),
      drop: (id) => Store.put(prefix + (id === undefined ? '' : id), null)
    };
  }

  /* A single value rather than a family of them. */
  function one(key) {
    return {
      get: () => Store.get(key),
      put: (value) => Store.put(key, value)
    };
  }

  /* Cached for maxAge, hit or miss. */
  function daily(prefix, maxAge) {
    return {
      get: (id) => Store.get(prefix + id).then((hit) =>
        (hit && Date.now() - hit.at < maxAge) ? hit.value : undefined),
      put: (id, value) => Store.put(prefix + id, { at: Date.now(), value: value })
    };
  }

  /* A hit is kept; a miss is asked again after maxAge. Returns undefined for
     "never asked", null for "asked, and there is none". */
  function misses(prefix, maxAge) {
    return {
      get: (id) => Store.get(prefix + id).then((hit) => {
        if (!hit) return undefined;
        if (hit.value) return hit.value;
        return Date.now() - hit.at < maxAge ? null : undefined;
      }),
      put: (id, value) => Store.put(prefix + id, { at: Date.now(), value: value })
    };
  }

  return {
    sections:  one('sections'),             // the servers' library lists
    rows:      kept('rows:'),               // a section's built rows, by section title
    total:     kept('total:'),              // a library part's length, by server:key:tag
    art:       kept('art:'),                // TMDB art and facts, by TMDB id
    meta:      kept('meta:'),               // full metadata, by server:ratingKey
    recaps:    kept('recaps:'),             // YouTube recaps for a show, by identity
    ytChannel: kept('youtube:channel:'),    // the recap channel's id, by handle
    /* A film can be added to a library but is rarely taken out, so a hit
       stands and only a miss is ever asked again. */
    lookup:    misses('tmdb:', 7 * DAY),    // do the servers hold this TMDB title
    catalogue: daily('disc:', DAY)          // a discovery category's films
  };
})();
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
  const BASE = {
    container: { mkv: true, mp4: true, mpegts: true },
    video: { h264: true, hevc: true },
    audio: { aac: true, ac3: true, eac3: true, mp3: true }
  };

  /* Candidates worth asking about, each with the mime the pipeline understands.
     Nothing here is claimed unless the answer comes back "probably". */
  const CANDIDATES = [
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

  let answers = null;          // [{ kind, name, mime, said }]
  let caps = null;             // BASE plus whatever the probe added
  let features = null;         // what the media element exposes beyond src/play

  function ask(mime) {
    const el = document.getElementById('video');
    if (!el || !el.canPlayType) return '';
    try { return el.canPlayType(mime) || ''; } catch (e) { return ''; }
  }

  function probe() {
    if (answers) return answers;
    answers = [];
    caps = {
      container: {}, video: {}, audio: {}
    };
    const kinds = ['container', 'video', 'audio'];
    let i;
    for (i = 0; i < kinds.length; i++) {
      const k = kinds[i];
      const keys = Object.keys(BASE[k]);
      for (let n = 0; n < keys.length; n++) caps[k][keys[n]] = true;
    }

    for (i = 0; i < CANDIDATES.length; i++) {
      const c = CANDIDATES[i];
      const said = ask(c.mime);
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
    const el = document.getElementById('video');
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
    const containers = list('container');
    const video = list('video').join(',');
    const audio = list('audio').join(',');
    const out = [];
    for (let i = 0; i < containers.length; i++) {
      out.push(`add-direct-play-profile(type=videoProfile&container=${containers[i]}` +
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
    const rows = probe();
    const lines = [];
    const kinds = ['video', 'container', 'audio'];
    lines.push('DECLARED TO THE SERVER');
    lines.push(`containers   ${list('container').join(', ')}`);
    lines.push(`video        ${list('video').join(', ')}`);
    lines.push(`audio        ${list('audio').join(', ')}`);
    lines.push('');
    lines.push('PANEL ANSWERED  (only "probably" is acted on)');
    for (let k = 0; k < kinds.length; k++) {
      const said = [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].kind === kinds[k]) said.push(rows[i].name + '=' + (rows[i].said || 'no'));
      }
      lines.push(kinds[k] + (kinds[k] === 'video' ? '        ' : (kinds[k] === 'audio' ? '        ' : '    ')) +
                 said.join('  '));
    }
    const f = probeFeatures();
    lines.push('');
    lines.push('PIPELINE');
    lines.push(`audioTracks  ${f.audioTracks}    textTracks ${f.textTracks}` +
               '    MediaSource ' + (f.mediaSource ? 'yes' : 'no'));
    lines.push(`webOS ${f.webOS ? f.webOSVersion : 'no'}` +
               '    frame stats ' + (f.playbackQuality ? 'yes' : 'no'));
    lines.push('');
    lines.push('Audio over ARC is a separate question: TrueHD and DTS-HD MA never');
    lines.push('pass, whatever the panel decodes.');
    return lines.join('\n');
  }

  return { probe: probe, supports: supports, list: list, features: probeFeatures,
           clientProfile: clientProfile, report: report };
})();
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
    const m = String(stamp).match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/);
    if (!m) return null;
    const frac = m[4] ? parseInt(m[4], 10) / Math.pow(10, m[4].length) : 0;
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
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const cues = [];
    let start;
    let end;
    let body;
    let line;

    for (let i = 0; i < lines.length; i++) {
      const arrow = lines[i].indexOf('-->');
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

    cues.sort((a, b) => { return a.start - b.start; });
    return cues;
  }

  /* First cue index starting after t. Binary, because a two-hour film has a
     couple of thousand cues and this runs on every timeupdate. */
  function after(cues, t) {
    let lo = 0;
    let hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /* What should be on screen at t, or '' for nothing. Cues overlap — two
     speakers, or a sign translated over dialogue — so this collects every one
     still open rather than the newest. */
  const OVERLAP = 12;                     // how far back an open cue can start

  function textAt(cues, t) {
    if (!cues || !cues.length) return '';
    const out = [];
    const i = after(cues, t);
    const stop = Math.max(0, i - OVERLAP);
    for (let j = i - 1; j >= stop; j--) {
      if (cues[j].end > t) out.unshift(cues[j].text);
    }
    return out.join('\n');
  }

  return { parse: parse, textAt: textAt, seconds: seconds };
})();

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

  const AUDIO_RANK = { eac3: 5, 'ec-3': 5, ac3: 4, aac: 3, mp3: 2, dca: 1, dts: 1 };

  /* A director's commentary is a perfectly good AC3 5.1 by every measure this
     ranking uses, and picking it ruins the film. It is also exactly what gets
     picked on a remux whose main track is TrueHD, because excluding the TrueHD
     leaves the commentary as the only passable thing on the file.

     Plex puts the word in the stream's title rather than flagging it, so this
     is a text match — deliberately broad, because being wrong in the other
     direction means two hours of someone talking over the film. */
  const NOT_THE_FILM =
    /commentar|descriptive|description|narrat|audio ?desc|\bdvs\b|\bad\b sign|karaoke/i;

  /** @param {PlexStream} st */
  function isCommentary(st) {
    if (!st) return false;
    const text = [st.title, st.displayTitle, st.extendedDisplayTitle].join(' ');
    return NOT_THE_FILM.test(text);
  }

  /* Can this track reach the amplifier untouched? TrueHD and DTS-HD MA cannot
     cross plain ARC at all, and anything the ranking does not know about is
     assumed not to. Says nothing about whether the track is worth playing —
     that is isCommentary's job. */
  /** @param {PlexStream} st */
  function passesArc(st) {
    const codec = ((st && st.codec) || '').toLowerCase();
    const profile = ((st && st.profile) || '').toLowerCase();
    if (codec === 'truehd') return false;
    if ((codec === 'dca' || codec === 'dts') && profile.indexOf('ma') === 0) return false;
    return AUDIO_RANK[codec] !== undefined;
  }

  /** @param {PlexStream} st */
  function audioScore(st) {
    const codec = (st.codec || '').toLowerCase();
    if (isCommentary(st)) return -1;
    if (!passesArc(st)) return -1;
    const rank = AUDIO_RANK[codec];
    const ch = st.channels || 2;
    let bonus;
    if (rank >= 4) bonus = Math.min(ch, 6);          // AC3/E-AC3: 5.1 preferred
    else bonus = (ch <= 2 ? 6 : 1);                  // AAC and below: stereo preferred
    return rank * 100 + bonus * 2 + (st.selected ? 1 : 0);
  }

  /* Returns the best passable audio stream on a part, or null if every track
     would force an audio transcode. */
  /** @param {PlexPart} part @returns {PlexStream|null} */
  function pickAudio(part) {
    const streams = (part && part.Stream) || [];
    let best = null;
    let bestScore = -1;
    let sc;
    for (let i = 0; i < streams.length; i++) {
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
  /** @param {PlexPart} part @returns {PlexStream|null} */
  function bestAudio(part) {
    const streams = (part && part.Stream) || [];
    let best = null;
    let bestScore = -1;
    let sc;
    for (let i = 0; i < streams.length; i++) {
      const st = streams[i];
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
    const codec = (st.codec || '?').toUpperCase();
    const lang = st.languageCode ? ` ${st.languageCode.toUpperCase()}` : '';
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
  /** @param {PlexPart} part @returns {PlexStream[]} */
  function audioTracks(part) {
    const streams = (part && part.Stream) || [];
    const out = [];
    for (let i = 0; i < streams.length; i++) {
      if (streams[i].streamType === 2) out.push(streams[i]);
    }
    return out;
  }

  function streamById(part, id) {
    const list = (part && part.Stream) || [];
    for (let i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /* What the file actually offers, for a refusal that says something useful.
     "only TrueHD or DTS-HD MA" was a lie the moment commentary tracks started
     being excluded too. */
  function audioSummary(part) {
    const streams = (part && part.Stream) || [];
    const out = [];
    for (let i = 0; i < streams.length; i++) {
      const st = streams[i];
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

  const LANGUAGES = {
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
    const code = String(st.languageCode || st.languageTag || '').toLowerCase();
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

  const TEXT_SUBS = { srt: 1, subrip: 1, ass: 1, ssa: 1, vtt: 1, webvtt: 1,
                    text: 1, mov_text: 1, subtitle: 1 };

  function isTextSub(st) {
    return !!(st && TEXT_SUBS[String(st.codec || '').toLowerCase()]);
  }

  /** @param {PlexPart} part @returns {PlexStream[]} */
  function subtitleTracks(part) {
    const streams = (part && part.Stream) || [];
    const out = [];
    for (let i = 0; i < streams.length; i++) {
      if (streams[i].streamType === 3) out.push(streams[i]);
    }
    return out;
  }

  function subLabel(st) {
    if (!st) return 'Off';
    const name = langName(st) || 'Unknown';
    const bits = [];
    if (st.forced) bits.push('forced');
    if (isCommentary(st)) bits.push('commentary');
    if (st.hearingImpaired || /sdh/i.test(String(st.title || ''))) bits.push('SDH');
    if (!isTextSub(st)) bits.push(String(st.codec || '?').toUpperCase() + ', image');
    else if (st.title && String(st.title).length < 24) bits.push(String(st.title));
    return name + (bits.length ? ` · ${bits.join(' · ')}` : '');
  }

  /* Which track to start with when the user asks for subtitles and has not
     said which: the one the file marks selected, else a plain forced track
     (a foreign-dialogue caption on an English film), else the first text one.
     Never an image track — it cannot be drawn — and never a commentary. */
  function pickSubtitle(part, languageCode) {
    const list = subtitleTracks(part);
    const usable = [];
    let i;
    let want;
    for (i = 0; i < list.length; i++) {
      const st = list[i];
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
    const list = (item && item.Marker) || [];
    const t = seconds * 1000;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (t >= (m.startTimeOffset || 0) && t < (m.endTimeOffset || 0)) return m;
    }
    return null;
  }

  function markerLabel(m) {
    const type = String((m && m.type) || '').toLowerCase();
    if (type === 'intro') return 'Skip intro';
    if (type === 'credits') return 'Skip credits';
    if (type === 'commercial') return 'Skip ad break';
    return 'Skip';
  }

  /* [{ title, start, end, thumb }] in seconds, in order. Both Marker and Chapter
     use the same offsets, so the trackbar can draw either. thumb is null far
     more often than not — Plex only carries one where it indexed the file. */
  function chapters(item) {
    const list = (item && item.Chapter) || [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      out.push({
        title: c.tag || c.title || (`Chapter ${c.index || i + 1}`),
        start: (c.startTimeOffset || 0) / 1000,
        end: (c.endTimeOffset || 0) / 1000,
        thumb: c.thumb || null
      });
    }
    out.sort((a, b) => { return a.start - b.start; });
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

  const BITRATES = [20000, 12000, 8000, 4000, 3000, 2000, 720];

  function bitrateLabel(kbps) {
    return kbps >= 1000 ? (kbps / 1000) + ' Mbps' : kbps + ' Kbps';
  }

  function versionLabel(media) {
    if (!media) return 'this version';
    const res = String(media.videoResolution || '').toLowerCase();
    const name = res === '4k' ? '4K' : (res ? res + 'p' : (media.height || '?') + 'p');
    let out = name + ' ' + String(media.videoCodec || '?').toUpperCase();
    if (media.bitrate) out += ` · ${bitrateLabel(media.bitrate)}`;
    return out;
  }

  /* [{ label, bitrate }] — bitrate null means the file as it is. */
  /** @param {PlexMedia} media */
  function qualities(media) {
    const source = (media && media.bitrate) || 0;
    const out = [];
    out.push({ label: `Original (${versionLabel(media)})`, bitrate: null });
    for (let i = 0; i < BITRATES.length; i++) {
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

  /** @param {PlexMedia} media */
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
  /** @param {PlexMedia} media @param {boolean} direct */
  function allows(media, direct) {
    return direct ? canDecode(media) : !isUHD(media);
  }

  /* ---------- certificates ---------- */

  const RATING_AGE = {
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
    let r = String(rating).toLowerCase().replace(/\s/g, '');
    const slash = r.lastIndexOf('/');
    if (slash >= 0) r = r.substring(slash + 1);      // strip "gb/", "us/"
    const m = r.match(/^(\d{1,2})/);                    // 12, 12a, 15, 18, 6, 7
    if (m) return parseInt(m[1], 10);
    return RATING_AGE[r] === undefined ? null : RATING_AGE[r];
  }

  /* Everything rated at or below this counts as kids viewing. */
  const KIDS_MAX_AGE = 12;

  function isKidsRating(rating) {
    const age = ageLimit(rating);
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

  /** @param {PlexItem} item @returns {string[]} */
  function externalIds(item) {
    const out = [];
    const g = (item && item.Guid) || [];
    for (let i = 0; i < g.length; i++) {
      const id = String(g[i].id || '').toLowerCase();
      if (id.indexOf('imdb://') === 0 || id.indexOf('tmdb://') === 0 ||
          id.indexOf('tvdb://') === 0) out.push(id);
    }
    /* The legacy agent form: com.plexapp.agents.imdb://tt0133093?lang=en */
    const legacy = String((item && item.guid) || '');
    const m = legacy.match(/agents\.(imdb|themoviedb|thetvdb):\/\/([^?/]+)/);
    if (m) {
      out.push((m[1] === 'themoviedb' ? 'tmdb' : (m[1] === 'thetvdb' ? 'tvdb' : 'imdb')) +
               '://' + m[2].toLowerCase());
    }
    return out;
  }

  function titleKey(item) {
    const t = String((item && (item.titleSort || item.title)) || '').toLowerCase()
      .replace(/^(the|a|an)\s+/, '')
      .replace(/[^a-z0-9]+/g, '');
    return `title://${t}/${(item && item.year) || ''}`;
  }

  /* An episode is identified by which show it belongs to and where it sits in
     it. Episodes often carry no external ids of their own, and their titles are
     not unique across shows — "Pilot" is everywhere — so season and episode
     number against the show's identity is what actually holds. */
  function episodeKey(item) {
    const show = String(item.grandparentGuid || item.grandparentTitle || '')
      .toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9:/.]+/g, '');
    const season = item.parentIndex === undefined ? '?' : item.parentIndex;
    const number = item.index === undefined ? '?' : item.index;
    return `episode://${show}/${season}/${number}`;
  }

  /* Every key this item could be recognised by, best first. */
  /** @param {PlexItem} item @returns {string[]} */
  function identities(item) {
    const out = externalIds(item);
    const guid = String((item && item.guid) || '');
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
    const s = item.parentIndex;
    const e = item.index;
    if (s === undefined && e === undefined) return item.grandparentTitle || '';
    return (item.grandparentTitle || '') +
           '  ·  S' + (s === undefined ? '?' : s) +
           'E' + (e === undefined ? '?' : (e < 10 ? `0${e}` : e));
  }

  /* The name of the thing, for the rail tile and the hero over it. An episode
     is named by its show: its own title says nothing on its own, and a rail of
     them all read as unrelated films. */
  function railTitle(item) {
    if (!item) return '';
    if (item.type === 'episode') return item.grandparentTitle || item.title || '';
    return item.title || '';
  }

  /* The line under it: where you are in a show, how long a film runs, how much
     of a series there is. Never more than one fact — this is a rail, not a
     detail page. */
  function railSub(item) {
    if (!item) return '';
    if (item.type === 'episode') {
      const s = item.parentIndex;
      const e = item.index;
      let at = '';
      if (s !== undefined) at = `S${s}`;
      if (e !== undefined) at += (at ? ' ' : '') + 'E' + e;
      if (!at) return item.title || '';
      return item.title ? at + '  ·  ' + item.title : at;
    }
    if (item.type === 'show') {
      if (item.childCount) return item.childCount + ' series';
      return item.year ? String(item.year) : '';
    }
    return item.duration ? Math.round(item.duration / 60000) + ' min' : '';
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
    identities: identities, identity: identity, episodeLabel: episodeLabel,
    railTitle: railTitle, railSub: railSub
  };
})();

/* The servers we can reach, and which one a given item came from.

   The account has more than one server, and the same film is often on both.
   Nothing in the app may assume "the server" — every request is made against a
   named one, and every item the app holds is stamped with where it came from so
   that posters, decisions and playback all go back to the right place.

   A server here is: { id, name, base, token }. `id` is the machine identifier,
   which is stable; `base` is whichever of its addresses answered first. */
var Servers = (function () {
  'use strict';

  let list = [];

  function ls(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* private mode / quota */ }
    return null;
  }

  function all() { return list; }
  function count() { return list.length; }

  function get(id) {
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* Items carry their origin as _server. Anything that lost the stamp is a bug
     upstream, but falling back to the first server beats throwing. */
  function of(item) {
    return (item && get(item._server)) || list[0] || null;
  }

  function stamp(items, server) {
    for (let i = 0; i < items.length; i++) if (items[i]) items[i]._server = server.id;
    return items;
  }

  function set(found) {
    list = found;
    ls('servers', JSON.stringify(list.map((sv) => {
      return { id: sv.id, name: sv.name, base: sv.base, token: sv.token };
    })));
  }

  function load() {
    const raw = ls('servers');
    loadPreference();
    if (!raw) return [];
    try { list = JSON.parse(raw) || []; } catch (e) { list = []; }
    return list;
  }

  function forget() {
    list = [];
    ls('servers', null);
  }

  /* Shortest label that still tells two servers apart. With one server there is
     nothing to say. */
  function label(server) {
    return count() > 1 && server ? server.name : '';
  }

  /* ---------- which one to reach for first ----------

     A film held by both servers is shown as the preferred server's copy, and
     that is the copy playback defaults to. A film the preferred server does not
     have simply appears as whoever does have it — the preference is a
     preference, not a filter. */

  let preferredId = null;

  function preferred() {
    if (preferredId && get(preferredId)) return preferredId;
    return list.length ? list[0].id : null;
  }

  function isPreferred(server) {
    return !!server && server.id === preferred();
  }

  function setPreferred(id) {
    preferredId = id;
    ls('preferredServer', id || null);
  }

  /* With a d-pad and no colour buttons, cycling is the cheapest control there
     is: the chip says which server is preferred and OK moves to the next. */
  function cyclePreferred() {
    if (list.length < 2) return preferred();
    let at = 0;
    const cur = preferred();
    for (let i = 0; i < list.length; i++) if (list[i].id === cur) at = i;
    setPreferred(list[(at + 1) % list.length].id);
    return preferred();
  }

  function loadPreference() { preferredId = ls('preferredServer'); }

  return { all: all, count: count, get: get, of: of, stamp: stamp,
           set: set, load: load, forget: forget, label: label,
           preferred: preferred, isPreferred: isPreferred,
           setPreferred: setPreferred, cyclePreferred: cyclePreferred,
           loadPreference: loadPreference };
})();
/* One entry per film, across servers.

   Two jobs, both built on Media.identities:

   - `lists` folds a handful of already-fetched lists (Continue watching, the
     category rows, search results) into one.
   - `stream` does the same for the All films row, which cannot be fetched in
     one go. Both servers sort by title, so their pages arrive as two sorted
     streams and are merged as you scroll — nothing is crawled, and only what
     you have walked past is held.

   A merged entry is one of the copies, with `_sources` listing every copy of
   it. The copies matter: the same film is often a 4K TrueHD remux on one
   server and a 1080p E-AC3 file on the other, and only one of those will
   direct play. Choosing between them is what js/detail.js is for. */
var Merge = (function () {
  'use strict';

  /* An index from every known identity to the merged entry holding it. */
  function index() { return { map: {}, out: [], dupes: 0 }; }

  function sortKey(item) {
    return String((item && (item.titleSort || item.title)) || '').toLowerCase();
  }

  function before(a, b) {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka !== kb) return ka < kb;
    return ((a && a.year) || 0) < ((b && b.year) || 0);
  }

  /* A copy is a library on a server, not a server: one section now spans
     several libraries, and the same film in a 4K library and an LQ one is two
     copies that play differently. Items folded by lists() — onDeck and the hubs
     — carry no part, so they still fold per server, as they always did. */
  function copyKey(item) { return item._server + '/' + (item._part || ''); }

  /* Fold a second copy of the same film into the entry, and decide which copy
     the entry should be *shown* as: the preferred server's, when it has one.
     That is what makes the preference visible — the badges in the masthead
     describe the copy you would get if you pressed OK and never looked at the
     detail page.

     `_sources` holds the OTHER copies, not this one: a self-reference would
     make the row a cycle, and these get written to IndexedDB. Read it through
     sources(), which puts the shown copy back at the front. */
  function combine(primary, item) {
    const extras = primary._sources || [];
    const key = copyKey(item);
    /* One copy per library. A film listed twice by the same library (two
       editions in one) is not what this is for — versions within one item are,
       and those live in Media[], not here. */
    if (copyKey(primary) === key) return primary;
    for (let i = 0; i < extras.length; i++) {
      if (copyKey(extras[i]) === key) return primary;
    }

    /* Plex syncs the position between servers, but if they disagree, the
       furthest through is the one worth resuming. */
    const offset = Math.max(primary.viewOffset || 0, item.viewOffset || 0);
    const seen = Math.max(primary.lastViewedAt || 0, item.lastViewedAt || 0);
    let shown;

    if (Servers.preferred() === item._server && primary._server !== Servers.preferred()) {
      delete primary._sources;
      item._sources = [primary].concat(extras);
      shown = item;
    } else {
      primary._sources = extras.concat([item]);
      shown = primary;
    }
    if (offset) shown.viewOffset = offset;
    if (seen) shown.lastViewedAt = seen;
    return shown;
  }

  /* Returns true if this started a new entry, false if it merged into one.
     `keys` may be passed in when the item has already been slimmed down and no
     longer carries the ids they were derived from. */
  function push(idx, item, keys) {
    if (!item) return false;
    let i;
    let at = -1;
    keys = keys || Media.identities(item);
    for (i = 0; i < keys.length; i++) {
      if (idx.map[keys[i]] !== undefined) { at = idx.map[keys[i]]; break; }
    }
    if (at >= 0) {
      idx.out[at] = combine(idx.out[at], item);
      /* Register this copy's other ids too, so a third copy matching on any of
         them lands in the same place. */
      for (i = 0; i < keys.length; i++) {
        if (idx.map[keys[i]] === undefined) idx.map[keys[i]] = at;
      }
      idx.dupes++;
      return false;
    }
    idx.out.push(item);
    at = idx.out.length - 1;
    for (i = 0; i < keys.length; i++) idx.map[keys[i]] = at;
    return true;
  }

  /* Fold several lists into one. Order is first-seen: the first server's list
     in its own order, with anything only the others have appended where it
     first appears. */
  function lists(arrays) {
    const idx = index();
    for (let i = 0; i < arrays.length; i++) {
      const arr = arrays[i] || [];
      for (let j = 0; j < arr.length; j++) push(idx, arr[j]);
    }
    return idx.out;
  }

  /* Every copy of this film, the one we are displaying first. */
  function sources(item) {
    if (!item) return [];
    return [item].concat(item._sources || []);
  }

  function isShared(item) { return !!(item && item._sources && item._sources.length); }

  /* ---------- the streaming merge ---------- */

  /* Only the fields the rail and the masthead actually draw. A merged All row
     keeps everything you have scrolled past, so a 30,000 film walk holds
     30,000 of these — whole Plex items would be several times the size. The
     detail page re-fetches anyway.

     Guid is the one costly field: a short array of { id } on every entry. It
     stays because without it a film walked into the All row has no TMDB id, so
     it gets neither a backdrop of its own nor a place in the merge by identity. */
  function slim(item) {
    const media = (item.Media && item.Media[0]) || null;
    const out = {
      ratingKey: item.ratingKey,
      _server: item._server,
      _part: item._part,
      title: item.title,
      titleSort: item.titleSort,
      year: item.year,
      duration: item.duration,
      contentRating: item.contentRating,
      thumb: item.thumb,
      art: item.art,
      summary: item.summary,
      guid: item.guid,
      Guid: item.Guid,
      viewOffset: item.viewOffset,
      lastViewedAt: item.lastViewedAt
    };
    if (media) {
      out.Media = [{
        videoResolution: media.videoResolution,
        videoCodec: media.videoCodec,
        container: media.container,
        width: media.width,
        height: media.height
      }];
    }
    return out;
  }

  /* parts: [{ server, key, filter, tag }] — one per server section being
     merged. fetch(part, offset) must resolve { items, total }. */
  function stream(parts, fetch) {
    return {
      fetch: fetch,
      streams: parts.map((p) => {
        return { part: p, offset: 0, buffer: [], total: 0, done: false, counted: false };
      }),
      idx: index(),
      exhausted: false,
      busy: null
    };
  }

  /* An upper bound until the walk finishes: every copy on every server, less
     the duplicates found so far. It only ever gets more accurate. */
  function estimate(st) {
    let total = 0;
    for (let i = 0; i < st.streams.length; i++) total += st.streams[i].total;
    return Math.max(st.idx.out.length, total - st.idx.dupes);
  }

  function items(st) { return st.idx.out; }

  function fetchInto(st, s) {
    return st.fetch(s.part, s.offset).then((res) => {
      const got = (res && res.items) || [];
      if (res && res.total) s.total = res.total;
      s.offset += got.length;
      for (let i = 0; i < got.length; i++) {
        /* Which library it came from: one section now spans several, and two
           of them can hold the same film in different shapes. */
        got[i]._part = s.part.key;
        s.buffer.push(got[i]);
      }
      if (!got.length || (s.total && s.offset >= s.total)) s.done = true;
      return s;
    }, () => {
      /* A server that stops answering drops out of the merge rather than
         stalling the row. */
      s.done = true;
      return s;
    });
  }

  /* Materialise the merged list until index `upTo` exists, or the servers run
     out. Concurrent calls share one walk. */
  function advance(st, upTo) {
    if (st.idx.out.length > upTo || st.exhausted) return Promise.resolve(st.idx.out);
    if (st.busy) return st.busy;
    st.busy = fill(st, upTo).then((out) => { st.busy = null; return out; },
                                  (e) => { st.busy = null; throw e; });
    return st.busy;
  }

  function fill(st, upTo) {
    let i;
    let live;
    let pick;
    /* A loop, not recursion: walking deep into a big library would otherwise
       build a stack frame per film. */
    while (st.idx.out.length <= upTo) {
      const needs = [];
      for (i = 0; i < st.streams.length; i++) {
        if (!st.streams[i].done && !st.streams[i].buffer.length) needs.push(st.streams[i]);
      }
      if (needs.length) {
        return Promise.all(needs.map((s) => { return fetchInto(st, s); }))
          .then(() => { return fill(st, upTo); });
      }
      live = [];
      for (i = 0; i < st.streams.length; i++) {
        if (st.streams[i].buffer.length) live.push(st.streams[i]);
      }
      if (!live.length) { st.exhausted = true; break; }

      pick = live[0];
      for (i = 1; i < live.length; i++) {
        if (before(live[i].buffer[0], pick.buffer[0])) pick = live[i];
      }
      /* Identities come off the full item — slimming drops the Guid array they
         are mostly derived from. */
      const raw = pick.buffer.shift();
      push(st.idx, slim(raw), Media.identities(raw));
    }
    return Promise.resolve(st.idx.out);
  }

  return {
    lists: lists, sources: sources, isShared: isShared, slim: slim,
    stream: stream, advance: advance, estimate: estimate, items: items,
    /* exported for the tests */
    push: push, index: index
  };
})();

/* Plex API. Chromium 53: Promises with .then(), no async/await, no object
   spread, no Object.entries.

   Every call that touches a media server takes that server as its first
   argument — see js/servers.js. There is deliberately no "current server"
   here: the account has more than one, the same film is on both, and the app
   has to be able to ask each of them separately. */
var Plex = (function () {
  'use strict';

  const TV       = Config.plexTvBase;
  const PRODUCT  = 'Reflex';
  const VERSION  = '0.0.1';
  /* The panel is webOS, but do NOT say so here.
     Measured against both of this account's servers, on 2026-08-13: the media
     decision engine answers 400 Bad Request — an HTML error page, not a Plex
     one — for X-Plex-Platform of webOS, WebOS, LG, Linux, or absent. Chrome,
     Safari, Android, Roku and tvOS all return a decision. Nothing else about
     the request matters; every query parameter was bisected first and none of
     them changes it.
     Chrome is the honest choice of the ones that work: the app IS Chromium 53
     under WAM, which is also what the platform version says. Product, device,
     model and device name still say Reflex on a B8, so the server's dashboard
     shows exactly what this is. */
  const PLATFORM = 'Chrome';
  const PLATFORM_VERSION = '53.0';
  const DEVICE   = 'LG OLED B8';

  /* Items per category row. The rail shows ten across and you have to scroll to
     reach the rest, so asking for thirty per hub per server was mostly payload
     we never drew — and it is on the critical path of the first paint. */
  const HUB_COUNT = 12;

  /* What we declare to the server is built from what the panel says it can
     play — see js/panel.js. It used to be a constant here, which meant the
     server re-encoded anything outside a hand-written list even when the B8
     would have played it untouched. */
  function profile() { return Panel.clientProfile(); }

  /* Two kinds of token, and they are not interchangeable. The account token is
     for plex.tv. Each server hands out its own access token via
     /api/v2/resources — a server you do NOT own rejects the account token with
     401, which is the case here (shared user). Server tokens live on the server
     objects in js/servers.js. */
  const s = { clientId: null, token: null };

  /* ---------- plumbing ---------- */

  function ls(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* private mode / quota */ }
    return null;
  }

  function uuid() {
    let out = '';
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  const qs = Http.qs;

  function headers() {
    return {
      'Accept': 'application/json',
      'X-Plex-Product': PRODUCT,
      'X-Plex-Version': VERSION,
      'X-Plex-Client-Identifier': s.clientId,
      'X-Plex-Platform': PLATFORM,
      'X-Plex-Platform-Version': PLATFORM_VERSION,
      'X-Plex-Device': DEVICE,
      'X-Plex-Device-Name': 'Reflex (B8)',
      'X-Plex-Model': 'OLED55B8',
      'X-Plex-Device-Screen-Resolution': '1920x1080,3840x2160'
    };
  }

  /* opts.token: the token to send, or false for none. A body that is not JSON
     is an answer here, not a failure: several endpoints reply in plain text. */
  function request(method, url, opts) {
    opts = opts || {};
    const h = headers();
    if (opts.token) h['X-Plex-Token'] = opts.token;
    return Http.request(url, {
      method: method,
      headers: h,
      timeout: opts.timeout,
      body: opts.body,
      text: true,
      label: method + ' ' + tidy(url),
      explain: why
    });
  }

  /* The declared profile is 500 characters of constant noise, and it is the
     same every time. Anything that ends up on screen or in a log is more use
     without it. */
  function tidy(url) {
    return String(url).replace(/X-Plex-Client-Profile-Extra=[^&]*/, 'X-Plex-Client-Profile-Extra=…');
  }

  /* Plex says why it refused, in the body. Throwing that away and reporting a
     bare status is how a 400 becomes unexplainable. */
  function why(xhr) {
    let body = '';
    try { body = xhr.responseText || ''; } catch (e) { return ''; }
    if (!body) return '';
    const m = body.match(/status="([^"]+)"/) ||        // <Response status="..."/>
            body.match(/"status"\s*:\s*"([^"]+)"/);
    if (m) return `  ·  ${m[1]}`;
    return `  ·  ${body.replace(/\s+/g, ' ').substring(0, 220)}`;
  }

  function tv(method, path, opts) {
    opts = opts || {};
    if (opts.token === undefined) opts.token = s.token;
    return request(method, TV + path, opts);
  }

  function ask(server, path, opts) {
    opts = opts || {};
    opts.token = server.token;
    return request('GET', server.base + path, opts);
  }

  /* ---------- auth ---------- */

  function init() {
    s.clientId = ls('clientId');
    if (!s.clientId) { s.clientId = uuid(); ls('clientId', s.clientId); }
    s.token = ls('token');
    Servers.load();
  }

  function hasToken() { return !!s.token; }

  /* No strong=true — that returns a long PIN for the auth-URL flow. plex.tv/link
     only accepts the plain 4-character code. */
  function linkStart() {
    return tv('POST', '/api/v2/pins', { token: false });
  }

  function wait(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

  /* Resolves with a token once the user has entered the code, or null if the
     pin expired. A failed poll is reported and retried rather than thrown — a
     single network blip must not throw the user back to a fresh code. */
  function linkPoll(pinId, deadline, onStatus) {
    let tries = 0;

    function attempt() {
      tries++;
      return tv('GET', `/api/v2/pins/${pinId}`, { token: false })
        .then((pin) => {
          if (pin && pin.authToken) {
            s.token = pin.authToken;
            ls('token', s.token);
            if (onStatus) onStatus('linked, token stored');
            return s.token;
          }
          if (onStatus) onStatus(`pin ${pinId} · poll ${tries} · not claimed yet`);
          if (Date.now() > deadline) return null;
          return wait(2000).then(attempt);
        }, (err) => {
          if (onStatus) onStatus(`pin ${pinId} · poll ${tries} FAILED: ${err.message}`);
          if (Date.now() > deadline) return null;
          return wait(3000).then(attempt);
        });
    }
    return attempt();
  }

  /* A 401 from a media server says nothing about the plex.tv login — drop the
     server list and rediscover rather than making the user link again. */
  function forgetServers() { Servers.forget(); }

  function signOut() {
    s.token = null;
    ls('token', null);
    Servers.forget();
  }

  /* ---------- server discovery ---------- */

  function ping(uri, token) {
    return request('GET', uri + '/identity', { timeout: 4000, token: token })
      .then(() => { return uri; });
  }

  /* Promise.any doesn't exist in Chromium 53. */
  function raceOk(promises) {
    return new Promise((resolve, reject) => {
      let left = promises.length;
      let settled = false;
      if (!left) { reject(new Error('nothing to race')); return; }
      promises.forEach((p) => {
        p.then((v) => {
          if (!settled) { settled = true; resolve(v); }
        }, () => {
          left--;
          if (left === 0 && !settled) reject(new Error('all connections failed'));
        });
      });
    });
  }

  /* Every server the account can reach, each on whichever of its addresses
     answers first. Relay connections are never used (CLAUDE.md: direct only).
     Unlike before, this keeps them ALL — the same film is often on more than
     one, and the app deduplicates rather than picking a winner. */
  function discover() {
    const cached = Servers.all();
    if (cached.length) {
      return Promise.all(cached.map((sv) => {
        return ping(sv.base, sv.token).then(() => { return sv; }, () => { return null; });
      })).then((live) => {
        const ok = live.filter((sv) => { return !!sv; });
        if (ok.length) { Servers.set(ok); return ok; }
        Servers.forget();
        return discover();
      });
    }

    return tv('GET', `/api/v2/resources?${qs({ includeHttps: 1, includeRelay: 0 })}`)
      .then((resources) => {
        const jobs = [];
        for (let i = 0; i < resources.length; i++) {
          const r = resources[i];
          if (!r.provides || r.provides.indexOf('server') < 0) continue;
          jobs.push(reach(r));
        }
        if (!jobs.length) throw new Error('no servers on this account');
        return Promise.all(jobs);
      })
      .then((found) => {
        const ok = found.filter((sv) => { return !!sv; });
        if (!ok.length) throw new Error('no direct server connection');
        /* Stable order, so rows do not reshuffle between launches. */
        ok.sort((a, b) => { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        Servers.set(ok);
        return ok;
      });
  }

  function reach(resource) {
    const token = resource.accessToken || s.token;
    const uris = [];
    for (let j = 0; j < (resource.connections || []).length; j++) {
      const c = resource.connections[j];
      if (c.relay) continue;
      uris.push(c.uri);
    }
    if (!uris.length) return Promise.resolve(null);
    return raceOk(uris.map((u) => { return ping(u, token); })).then((uri) => {
      return { id: resource.clientIdentifier, name: resource.name || 'server',
               base: uri, token: token };
    }, () => { return null; });
  }

  /* ---------- library ---------- */

  function sections(server) {
    return ask(server, '/library/sections').then((res) => {
      const dirs = (res.MediaContainer && res.MediaContainer.Directory) || [];
      const out = [];
      for (let i = 0; i < dirs.length; i++) {
        /* Movies and shows. Music and photos are not something this app has any
           business drawing. */
        if (dirs[i].type !== 'movie' && dirs[i].type !== 'show') continue;
        /* updatedAt is what lets us skip re-crawling an unchanged section. */
        out.push({ key: dirs[i].key, title: dirs[i].title, type: dirs[i].type,
                   updatedAt: dirs[i].updatedAt || 0, server: server.id });
      }
      return out;
    }).catch(() => { return []; });
  }

  /* type 1 is movies, 2 is shows — pass it in `extra` for a show section. */
  function items(server, sectionKey, start, size, extra) {
    const params = {
      type: 1,
      sort: 'titleSort:asc',
      includeCollections: 0,
      includeExternalMedia: 0,
      includeGuids: 1,
      'X-Plex-Container-Start': start,
      'X-Plex-Container-Size': size
    };
    /* Filters (e.g. contentRating) are applied server side — never pull a
       section down to sieve it here. */
    if (extra) {
      const keys = Object.keys(extra);
      for (let i = 0; i < keys.length; i++) params[keys[i]] = extra[keys[i]];
    }
    return ask(server, `/library/sections/${sectionKey}/all?${qs(params)}`,
               { timeout: 20000 }).then((res) => {
      const mc = res.MediaContainer || {};
      return { total: mc.totalSize || mc.size || 0,
               items: Servers.stamp(mc.Metadata || [], server) };
    });
  }

  /* Which certificates this library actually uses. Asking beats hardcoding —
     the server may label things BBFC (U, PG, 12A, 15, 18) or MPAA (G, PG-13,
     R), or prefix them by region ("gb/12A"). */
  function contentRatings(server, sectionKey) {
    return ask(server, `/library/sections/${sectionKey}/contentRating`)
      .then((res) => {
        const dirs = (res.MediaContainer && res.MediaContainer.Directory) || [];
        const out = [];
        for (let i = 0; i < dirs.length; i++) out.push(dirs[i].title || dirs[i].key);
        return out;
      }).catch(() => { return []; });
  }

  /* Continue Watching. /library/onDeck is the universally supported endpoint —
     /hubs/continueWatching only exists on newer servers. One request. */
  /* Films and episodes both turn up here, and an episode is the more common
     case on a real server. */
  function onDeck(server) {
    return ask(server, `/library/onDeck?${qs({ includeGuids: 1 })}`).then((res) => {
      const md = (res.MediaContainer && res.MediaContainer.Metadata) || [];
      return Servers.stamp(md.filter((m) => {
        return m.type === 'movie' || m.type === 'episode';
      }), server);
    }).catch(() => { return []; });
  }

  /* ---------- getting things off the deck ----------

     Two endpoints, tried in that order. Only the first is what the user
     actually means — it hides the item and leaves its watch state alone — but
     it exists only on newer servers, and these are not our servers. Which one
     a server has is found out by asking it, not by reading a version number:
     versions lie, and the fallback has to exist either way. */

  /* Whether a server answered removeFromContinueWatching. Memory only, so a
     row of ten does not rediscover the same 404 ten times and an upgraded
     server is not written off for ever. */
  const canHide = {};

  /* Hide an item from Continue watching without touching its watch state.
     Resolves false where the server has no such endpoint, so the caller can ask
     about the destructive alternative rather than fall into it. */
  function hideFromDeck(server, ratingKey) {
    if (canHide[server.id] === false) return Promise.resolve(false);
    return request('PUT', server.base + '/actions/removeFromContinueWatching?' +
                   qs({ ratingKey: ratingKey }), { token: server.token })
      .then(() => { canHide[server.id] = true; return true; }, (e) => {
        if (!/-> 40[04](\s|$)/.test(e.message)) throw e;
        canHide[server.id] = false;
        return false;
      });
  }

  /* Mark an item watched, which is how an older server is made to forget it.
     Plex propagates a show's scrobble down to every episode of it. */
  function scrobble(server, ratingKey) {
    return request('PUT', server.base + '/:/scrobble?' +
                   qs({ key: ratingKey, identifier: 'com.plexapp.plugins.library' }),
                   { token: server.token });
  }

  /* The show hierarchy, one level at a time: a show's children are its seasons,
     a season's are its episodes. Never /allLeaves on a library we don't own —
     one show at a time is the whole point. */
  function children(server, ratingKey) {
    return ask(server, `/library/metadata/${ratingKey}/children?` +
               qs({ includeGuids: 1 }), { timeout: 20000 }).then((res) => {
      const md = (res.MediaContainer && res.MediaContainer.Metadata) || [];
      return Servers.stamp(md, server);
    }).catch(() => { return []; });
  }

  /* The section's own categories — Recently Added, Recently Released and so on.
     One request returns every hub with its items, which is how the stock app
     shows a huge library without listing it. */
  function hubs(server, sectionKey) {
    return ask(server, `/hubs/sections/${sectionKey}?` +
               qs({ count: HUB_COUNT, includeGuids: 1 }),
               { timeout: 20000 }).then((res) => {
      const list = (res.MediaContainer && res.MediaContainer.Hub) || [];
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (!h.Metadata || !h.Metadata.length) continue;
        if (h.type !== 'movie' && h.type !== 'show') continue;
        out.push({ title: h.title, items: Servers.stamp(h.Metadata, server) });
      }
      return out;
    }).catch(() => { return []; });
  }

  /* ponytail: movies only, because show drill-down doesn't exist yet (task 3).
     Widen the type filter when it does. */
  function search(server, query) {
    return ask(server, `/hubs/search?${qs({ query: query, limit: 40 })}`, { timeout: 20000 })
      .then((res) => {
        const list = (res.MediaContainer && res.MediaContainer.Hub) || [];
        const out = [];
        for (let i = 0; i < list.length; i++) {
          const h = list[i];
          if (!h.Metadata) continue;
          for (let j = 0; j < h.Metadata.length; j++) {
            if (h.Metadata[j].type === 'movie' || h.Metadata[j].type === 'show') {
              out.push(h.Metadata[j]);
            }
          }
        }
        return Servers.stamp(out, server);
      }).catch(() => { return []; });
  }

  /* Watch history. Plex attributes everything to the account, not the person,
     but each entry records which device played it — which is the only handle we
     have on "that was the other TV, not me". */
  function history(server, size) {
    return ask(server, '/status/sessions/history/all?' + qs({
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': size || 200
    }), { timeout: 20000 }).then((res) => {
      return (res.MediaContainer && res.MediaContainer.Metadata) || [];
    }).catch(() => { return []; });
  }

  function devices(server) {
    return ask(server, '/devices').then((res) => {
      const d = (res.MediaContainer && res.MediaContainer.Device) || [];
      const out = [];
      for (let i = 0; i < d.length; i++) {
        out.push({ id: String(d[i].id),
                   name: d[i].name || d[i].clientIdentifier || (`device ${d[i].id}`),
                   platform: d[i].platform || '' });
      }
      return out;
    }).catch(() => { return []; });
  }

  /* Find a library item by external id, e.g. 'tmdb://27205'. This is the join
     that lets us start from a curated external list and ask what the server
     has, instead of crawling the library. */
  function copiesByGuid(server, guid) {
    return ask(server, `/library/all?${qs({ guid: guid, includeGuids: 1 })}`, { timeout: 15000 })
      .then((res) => {
        const m = (res.MediaContainer && res.MediaContainer.Metadata) || [];
        return Servers.stamp(m, server);
      }).catch(() => { return []; });
  }

  function findByGuid(server, guid) {
    return copiesByGuid(server, guid).then((m) => { return m.length ? m[0] : null; });
  }

  /* Every copy of a film on this server, wherever it lives.
     /library/all is global, which matters: these libraries keep the 4K version
     of a film in a SEPARATE SECTION ("Movies" and "Movies - 4K UHD"), so the
     other version is not another entry in Media[] — it is a different library
     item under a different chip, and only a guid lookup finds it. */
  function allVersions(server, item) {
    const ids = [];
    const g = (item && item.Guid) || [];
    if (item && item.guid && String(item.guid).indexOf('plex://') === 0) ids.push(item.guid);
    for (let i = 0; i < g.length; i++) if (g[i].id) ids.push(g[i].id);
    if (!ids.length) return Promise.resolve([]);

    /* Try the ids in order and take the first that finds anything — one
       request in the normal case. */
    function attempt(n) {
      if (n >= ids.length) return Promise.resolve([]);
      return copiesByGuid(server, ids[n]).then((found) => {
        return found.length ? found : attempt(n + 1);
      });
    }
    return attempt(0);
  }

  /* TMDB id off an item, handling both the modern Guid array and the legacy
     agent form (com.plexapp.agents.themoviedb://123?lang=en). */
  function tmdbId(item) {
    const g = (item && item.Guid) || [];
    for (let i = 0; i < g.length; i++) {
      const id = g[i].id || '';
      if (id.indexOf('tmdb://') === 0) return id.substring(7);
    }
    const m = String((item && item.guid) || '').match(/themoviedb:\/\/(\d+)/);
    return m ? m[1] : null;
  }

  /* includeMarkers is where "Skip intro" comes from: the server has already
     analysed the film and knows where the intro and the end credits are, so
     there is nothing to detect on the panel — only something to offer at the
     right moment. includeChapters gives the trackbar its ticks. Both are part
     of the same payload the app already fetches, so neither costs a request. */
  function metadata(server, ratingKey) {
    return ask(server, `/library/metadata/${ratingKey}?` +
               qs({ includeGuids: 1, includeExtras: 1,
                    includeMarkers: 1, includeChapters: 1 })).then((res) => {
      const m = res.MediaContainer && res.MediaContainer.Metadata;
      if (!m || !m[0]) return null;
      /* Extras arrive nested and are playable in their own right, so they need
         stamping too or nothing can tell which server they came from. */
      if (m[0].Extras && m[0].Extras.Metadata) Servers.stamp(m[0].Extras.Metadata, server);
      return Servers.stamp(m, server)[0];
    });
  }

  function photoUrl(server, imagePath, w, h) {
    if (!server || !imagePath) return '';
    return server.base + '/photo/:/transcode?' + qs({
      width: w, height: h, minSize: 1, upscale: 1,
      url: imagePath + '?X-Plex-Token=' + server.token,
      'X-Plex-Token': server.token
    });
  }

  /* Items are stamped with the server they came from, so callers do not have to
     carry it around just to draw a poster. */
  function posterUrl(item, w, h) {
    if (!item || !item.thumb) return '';
    return photoUrl(Servers.of(item), item.thumb, w, h);
  }

  function artUrl(item, w, h) {
    if (!item || !item.art) return '';
    return photoUrl(Servers.of(item), item.art, w, h);
  }

  /* A show's theme tune, or '' when it has none — most shows do not, and that
     is normal. A plain file GET like a poster: no decision, no session. */
  function themeUrl(server, item) {
    if (!server || !item || !item.theme) return '';
    return server.base + item.theme + '?X-Plex-Token=' + server.token;
  }

  /* ---------- playback decision ---------- */

  let sessionId = null;
  function session() {
    if (!sessionId) sessionId = uuid();
    return sessionId;
  }

  /* hasMDE=1 returns the verdict WITHOUT opening a session, so this is safe to
     call on a server we don't own. Never call the non-decision transcode
     endpoints. */
  /* opts.maxBitrate (kbps) is the quality menu. It only means anything on a
     converted stream — asking for a cap IS asking the server to re-encode —
     so the decision call is given it too, and answers honestly that it will
     transcode. On a 4K file that is a refusal, which is the point.

     opts.forceStream is audio track selection, and it exists because of a
     thing that is easy to get wrong: on a DIRECT PLAY the server hands over
     the original file, whole. `audioStreamID` is advisory to the decision
     engine and changes not one byte of it, so the panel goes on playing
     whichever track it likes — usually the first. The only way to be given a
     specific track is to stop asking for a direct play, so that the server
     muxes the stream itself. That costs a session; it is the honest price of
     choosing, and it is only paid when the panel cannot choose for us. */
  function playbackParams(server, item, mediaIndex, partIndex, audioStreamId, opts) {
    opts = opts || {};
    return {
      hasMDE: 1,
      path: `/library/metadata/${item.ratingKey}`,
      mediaIndex: mediaIndex,
      partIndex: partIndex,
      protocol: 'http',
      directPlay: (opts.maxBitrate || opts.forceStream) ? 0 : 1,
      directStream: 1,
      directStreamAudio: 1,
      fastSeek: 1,
      /* Never burned in. Subtitles are fetched as text and drawn over the
         video — see js/subs.js — because burning them into the picture is a
         transcode, and a transcode of a 4K file is what gets a session
         killed. */
      subtitles: 'none',
      audioBoost: 100,
      /* directPlay is off the table once a cap is asked for; leaving it on
         makes the server answer directplay and ignore the cap entirely. */
      maxVideoBitrate: opts.maxBitrate || null,
      videoBitrate: opts.maxBitrate || null,
      autoAdjustQuality: 0,
      mediaBufferSize: 102400,
      /* ponytail: we connect directly, not via relay, so 'lan' is what keeps
         the server's remote-quality cap out of the decision. probe.py varies
         this — if a row shows 'wan' also direct plays, prefer honesty. */
      location: 'lan',
      session: session(),
      audioStreamID: audioStreamId || null,
      /* In the query, not just the header. The transcode endpoints rebuild this
         URL internally and look for the token in it — /photo/:/transcode has
         always been given it here, and this one refuses with a 400 rather than
         a 401 when it is missing, which reads as a malformed request rather
         than an unauthenticated one. */
      'X-Plex-Token': server.token,
      'X-Plex-Client-Profile-Extra': profile()
    };
  }

  function decide(server, item, mediaIndex, partIndex, audioStreamId, opts) {
    const params = playbackParams(server, item, mediaIndex, partIndex, audioStreamId, opts);
    return ask(server, `/video/:/transcode/universal/decision?${qs(params)}`,
               { timeout: 20000 }).then((res) => {
      const mc = res.MediaContainer || {};
      const md = (mc.Metadata && mc.Metadata[0]) || null;
      const part = md && md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
      const streams = (part && part.Stream) || [];
      let video = '';
      let audio = '';
      /* Per stream, so "the audio needs re-encoding" can be told apart from
         "the whole thing does" — one of those is acceptable here and the other
         is what gets a 4K session killed. */
      for (let i = 0; i < streams.length; i++) {
        if (streams[i].streamType === 1 && !video) video = streams[i].decision || '';
        if (streams[i].streamType === 2 && !audio) audio = streams[i].decision || '';
      }
      return {
        decision: (part && part.decision) || 'unknown',
        video: video, audio: audio,
        text: mc.transcodeDecisionText || mc.generalDecisionText || mc.mdeDecisionText || '',
        raw: mc
      };
    });
  }

  /* Where to play from when the server has to re-encode something. HLS,
     because that is what the panel's own media pipeline handles — a desktop
     browser will not play this, so it cannot be tested on the laptop.
     Calling this DOES open a session on the server. */
  function transcodeUrl(server, item, mediaIndex, partIndex, audioStreamId, opts) {
    const params = playbackParams(server, item, mediaIndex, partIndex, audioStreamId, opts);
    params.hasMDE = null;
    params.protocol = 'hls';
    params.copyts = 1;
    params.directPlay = 0;
    return server.base + '/video/:/transcode/universal/start.m3u8?' + qs(params);
  }

  function streamUrl(server, part) {
    return server.base + part.key + '?' + qs({ 'X-Plex-Token': server.token });
  }

  /* ---------- subtitles ----------

     One small GET for the whole text track, which is the entire cost of
     subtitles here — no session, no re-encode, nothing on the admin's
     dashboard. An embedded track is extracted by the server on request; a
     sidecar file is served as it is. Both arrive as SRT or WebVTT, which
     js/subs.js parses. */

  function subtitleUrl(server, stream) {
    const path = (stream && stream.key) || (`/library/streams/${stream && stream.id}`);
    return server.base + path + '?' + qs({ encoding: 'utf-8', 'X-Plex-Token': server.token });
  }

  function subtitles(server, stream) {
    return request('GET', subtitleUrl(server, stream), { timeout: 15000 })
      .then((body) => {
        /* request() parses JSON when it can; a subtitle file never is one, so
           anything but a string here means the server answered with something
           other than the track. */
        if (typeof body !== 'string' || !body) throw new Error('the server returned no text');
        return body;
      });
  }

  /* ---------- progress ---------- */

  /* Reported to the server we are playing from. Plex syncs the position to the
     account, which is why the same film picked up on the other server resumes
     in the right place. */
  function timeline(server, item, state, timeMs, durationMs) {
    return ask(server, '/:/timeline?' + qs({
      ratingKey: item.ratingKey,
      key: `/library/metadata/${item.ratingKey}`,
      state: state,
      time: Math.floor(timeMs),
      duration: Math.floor(durationMs),
      playbackTime: Math.floor(timeMs),
      hasMDE: 1
    }), { timeout: 8000 }).catch(() => { return null; });
  }

  return {
    init: init, hasToken: hasToken, signOut: signOut,
    linkStart: linkStart, linkPoll: linkPoll, forgetServers: forgetServers,
    discover: discover, state: s,
    sections: sections, items: items, metadata: metadata,
    posterUrl: posterUrl, artUrl: artUrl, photoUrl: photoUrl, themeUrl: themeUrl,
    onDeck: onDeck, hideFromDeck: hideFromDeck, scrobble: scrobble,
    hubs: hubs, search: search, children: children,
    history: history, devices: devices, findByGuid: findByGuid, tmdbId: tmdbId,
    allVersions: allVersions,
    contentRatings: contentRatings,
    decide: decide, streamUrl: streamUrl, transcodeUrl: transcodeUrl, timeline: timeline,
    subtitles: subtitles, subtitleUrl: subtitleUrl
  };
})();
/* TMDB client. Chromium 53.

   Deliberately external-first: fetch a small curated list from TMDB (one
   request, ~20 titles), then ask Plex which of them it has, by TMDB id. The
   opposite direction — indexing 30k library items against TMDB — would need a
   full crawl of a server we don't own, and a backend to run it on.

   Needs a free TMDB v3 API key. Without one the discovery rows simply don't
   appear; nothing else is affected. */
var Tmdb = (function () {
  'use strict';

  const KEY = Config.tmdbKey;                      // see js/config.js
  const API = Config.tmdbBase;                     // see js/config.js
  const REGION = 'GB';

  /* The rubbish filter. Junk has almost no votes, so a floor removes most of it
     without any taste modelling at all. */
  const MIN_VOTES = 500;

  function enabled() { return !!KEY; }

  function get(path, params) {
    params = params || {};
    params.api_key = KEY;
    return Http.request(API + path + '?' + Http.qs(params), { label: `TMDB ${path}` });
  }

  function goodEnough(m) {
    return m && m.id && (m.vote_count || 0) >= MIN_VOTES;
  }

  /* Enough to draw a tile with and nothing more: the rest of a TMDB result is
     never shown, and a discovery row holds a dozen of these per category. */
  function film(m) {
    return { id: String(m.id), title: m.title || '',
             year: Number(String(m.release_date || '').slice(0, 4)) || null,
             poster_path: m.poster_path || null,
             backdrop_path: m.backdrop_path || null,
             vote_average: m.vote_average || 0 };
  }

  function films(results) {
    const out = [];
    for (let i = 0; i < (results || []).length; i++) {
      if (goodEnough(results[i])) out.push(film(results[i]));
    }
    return out;
  }

  function trending() {
    return get('/trending/movie/week').then((r) => { return films(r.results); });
  }

  /* What's on a streaming service right now, in this region. */
  function onProvider(providerId) {
    return get('/discover/movie', {
      with_watch_providers: providerId,
      watch_region: REGION,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then((r) => { return films(r.results); });
  }

  /* One genre, most popular first. Ids come from /genre/movie/list. */
  function byGenre(genreId) {
    return get('/discover/movie', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      'vote_count.gte': MIN_VOTES
    }).then((r) => { return films(r.results); });
  }

  /* Content-based recommendations: ask TMDB what resembles each thing recently
     watched, then count how often each suggestion comes up. No model, no
     training — frequency across several seeds is enough to be useful. */
  function recommendedFrom(seedTmdbIds) {
    const seeds = (seedTmdbIds || []).slice(0, 8);
    if (!seeds.length) return Promise.resolve([]);
    const score = {};
    const seen = {};
    return serial(seeds, (id) => {
      return get(`/movie/${id}/recommendations`).then((r) => {
        const list = films(r.results);
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (seeds.indexOf(m.id) >= 0) continue;              // don't suggest the seed
          seen[m.id] = m;
          score[m.id] = (score[m.id] || 0) + 1;
        }
      }, () => { /* one bad seed shouldn't sink the row */ });
    }).then(() => {
      return Object.keys(score).sort((a, b) => { return score[b] - score[a]; })
        .map((id) => { return seen[id]; });
    });
  }

  /* One category from Config.categories to its films. An unknown kind is a typo
     in the config rather than a crash: it gives an empty row. `seeds` are TMDB
     ids of what has been watched, and only the recommended kind uses them. */
  function catalogue(category, seeds) {
    const kind = category && category.kind;
    if (kind === 'trending') return trending();
    if (kind === 'provider') return onProvider(category.id);
    if (kind === 'genre') return byGenre(category.id);
    if (kind === 'recommended') return recommendedFrom(seeds);
    return Promise.resolve([]);
  }

  /* Everything js/art.js keeps about a film in one request: the backdrops, the
     overview, the run time and the billing order. `include_image_language`
     matters — without it the appended images are filtered to the request
     language and most backdrops disappear. */
  function details(tmdbId) {
    return get(`/movie/${tmdbId}`, {
      append_to_response: 'images,credits',
      include_image_language: 'en,null'
    });
  }

  /* One at a time, on purpose — this is a courtesy API and the rows are small. */
  function serial(list, fn) {
    let i = 0;
    function step() {
      if (i >= list.length) return Promise.resolve();
      return fn(list[i++]).then(step);
    }
    return step();
  }

  return {
    enabled: enabled,
    trending: trending,
    onProvider: onProvider,
    byGenre: byGenre,
    recommendedFrom: recommendedFrom,
    catalogue: catalogue,
    details: details
  };
})();
/* YouTube client: season recaps from one channel, and nothing else. Chromium 53.

   Same shape as js/tmdb.js — a key from js/config.js, a plain XMLHttpRequest,
   and inert without the key. The difference is when it runs: a search costs 100
   units of a 10,000/day quota, so nothing here is called until the user presses
   Find recaps on a show. See js/showpage.js. */
var Youtube = (function () {
  'use strict';

  const KEY = Config.youtubeKey;                   // see js/config.js
  const API = Config.youtubeBase;                  // see js/config.js

  /* The channel by handle, not by id: a guessed id in source would be wrong and
     unverifiable, and a handle is something a human can check. */
  const HANDLE = '@ManOfRecaps';

  const SEASON = /\b(?:season|series|s)\s*0*(\d{1,2})\b/i;

  /* Is there a key at all? Without one the recaps action never appears. */
  function enabled() { return !!KEY; }

  function request(path, params) {
    params.key = KEY;
    return Http.request(API + path + '?' + Http.qs(params), { label: `YouTube ${path}` });
  }

  /* One request in flight at a time. Two searches racing is 200 units spent to
     answer one question. */
  let queue = Promise.resolve();
  function get(path, params) {
    function run() { return request(path, params); }
    queue = queue.then(run, run);
    return queue;
  }

  /* The channel id behind the handle, resolved once and kept for good. */
  function channelId() {
    return Cached.ytChannel.get(HANDLE).then((cached) => {
      if (cached) return cached;
      return get('/channels', { part: 'id', forHandle: HANDLE }).then((r) => {
        const items = r && r.items;
        if (!items || !items.length || !items[0].id) {
          throw new Error(`no channel for ${HANDLE}`);
        }
        Cached.ytChannel.put(HANDLE, items[0].id);
        return items[0].id;
      });
    });
  }

  /* This show's recaps from that channel, raw. 100 units a press, so only ever
     called from a keypress; a quota refusal answers with nothing rather than an
     error, because "none today" is the truth the screen has to show. */
  function recaps(showTitle) {
    return channelId().then((id) => {
      return get('/search', {
        part: 'snippet', channelId: id, q: showTitle + ' recap',
        maxResults: 25, type: 'video'
      });
    }).then((r) => {
      return withLengths((r && r.items) || []);
    }).catch((e) => {
      if (!/-> 403$/.test(e.message)) throw e;
      UI.debug(`youtube: ${e.message} (quota)`);
      return [];
    });
  }

  /* search carries no duration and videos.list does — one more unit against the
     hundred the search already cost. A missing length is a missing caption, not
     a missing rail, so a failure here keeps the items. */
  function withLengths(items) {
    const ids = [];
    let id;
    for (let i = 0; i < items.length; i++) {
      id = items[i].id && items[i].id.videoId;
      if (id) ids.push(id);
    }
    if (!ids.length) return Promise.resolve(items);
    return get('/videos', { part: 'contentDetails', id: ids.join(',') }).then((r) => {
      const by = {};
      let k;
      const list = (r && r.items) || [];
      for (k = 0; k < list.length; k++) by[list[k].id] = list[k].contentDetails;
      for (k = 0; k < items.length; k++) {
        id = items[k].id && items[k].id.videoId;
        if (by[id]) items[k].contentDetails = by[id];
      }
      return items;
    }, () => { return items; });
  }

  function seasonOf(title) {
    const m = SEASON.exec(title);
    return m ? Number(m[1]) : null;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* PT1H2M3S -> 1:02:03. Anything else has no length to show. */
  function lengthOf(iso) {
    const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/.exec(iso || '');
    if (!m) return '';
    const h = Number(m[1] || 0);
    const mins = Number(m[2] || 0);
    const secs = Number(m[3] || 0);
    return h ? h + ':' + pad(mins) + ':' + pad(secs) : mins + ':' + pad(secs);
  }

  function thumbOf(snippet) {
    const t = (snippet && snippet.thumbnails) || {};
    const pick = t.medium || t.high || t.default;
    return (pick && pick.url) || '';
  }

  /* The API payload as the rail wants it, in season order with the unnumbered
     ones last. Never throws: a malformed item is simply not a recap. */
  function parse(items) {
    const list = items || [];
    const out = [];
    let id;
    let title;
    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      id = it.id && it.id.videoId;
      title = (it.snippet && it.snippet.title) || '';
      if (!id || !title) continue;
      out.push({
        id: id,
        title: title,
        thumb: thumbOf(it.snippet),
        season: seasonOf(title),
        length: lengthOf(it.contentDetails && it.contentDetails.duration)
      });
    }
    return bySeason(out);
  }

  /* Sorting the positions rather than the list: Chromium 53's sort is not
     stable, and within a season the order the API chose is the one to keep. */
  function bySeason(list) {
    const order = [];
    const out = [];
    let i;
    for (i = 0; i < list.length; i++) order.push(i);
    order.sort((a, b) => {
      const x = list[a].season;
      const y = list[b].season;
      if (x === y) return a - b;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    });
    for (i = 0; i < order.length; i++) out.push(list[order[i]]);
    return out;
  }

  function normalise(s) {
    return ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '')} `;
  }

  /* Only the videos that name this show. The channel covers everything, and a
     search for a one-word title brings back most of it. */
  function pickForShow(parsed, showTitle) {
    const want = normalise(showTitle);
    const out = [];
    if (want.length < 3) return [];               // no title left to match on
    for (let i = 0; i < (parsed || []).length; i++) {
      if (normalise(parsed[i].title).indexOf(want) >= 0) out.push(parsed[i]);
    }
    return out;
  }

  return {
    enabled: enabled,
    channelId: channelId,
    recaps: recaps,
    parse: parse,
    pickForShow: pickForShow
  };
})();

/* Which picture goes where. Chromium 53.

   The tile is a poster and the hero is a backdrop, so the two can never be the
   same picture — a portrait 2:3 and a landscape 16:9 are different images by
   construction rather than by a fallback ladder. TMDB carries both in one
   payload; Plex carries `thumb` (a poster, or an episode still) and `art`.

   The same request carries the overview, the run time and the billing order, so
   the header's description and key actors cost nothing beyond the backdrops.

   Nothing here ever waits: tile(), hero() and factsFor() answer synchronously
   from cache or fall back to what Plex has, and warm() tells its listeners when
   a title's payload lands so the tile, the backdrop and the header can be
   repainted. One lookup per title actually on screen, cached both ways — never
   a crawl. */
var Art = (function () {
  'use strict';

  /* The tile is 209 wide, so w342 is the next size up — w500 was for a tile
     nearly twice as wide and is now a third of a megabyte per poster wasted. */
  const POSTER_SIZE = 'w342';
  const HERO_SIZE = 'w1280';
  const MAX_IN_FLIGHT = 4;
  const CAST = 4;          // names in the header's key actors line

  const cache = {};        // tmdbId -> { hero: path|null, poster: path|null, facts: {} }
  const pending = {};      // tmdbId -> true while a lookup is queued or running
  const queue = [];
  let active = 0;
  const listeners = [];

  /* The best-voted path out of one of TMDB's image lists, or null. */
  function bestOf(list) {
    const usable = [];
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].file_path) usable.push(list[i]);
    }
    usable.sort((a, b) => {
      const byScore = (b.vote_average || 0) - (a.vote_average || 0);
      return byScore || (b.vote_count || 0) - (a.vote_count || 0);
    });
    return usable.length ? usable[0].file_path : null;
  }

  /* The backdrop behind the header and the poster on the tile, from one
     payload. Pure, and never throws: nothing usable gives two nulls. */
  function pick(payload) {
    /* The images used to be the whole payload and are now appended to it,
       so both shapes are read — the old cache entries are still the old one. */
    const images = (payload && payload.images) || payload || {};
    return { hero: bestOf(images.backdrops), poster: bestOf(images.posters) };
  }

  /* What the header says about a title, out of the same payload the backdrops
     came from. Pure, and never throws: anything missing gives empty. */
  function facts(payload) {
    const credits = (payload && payload.credits) || {};
    const billing = Array.isArray(credits.cast) ? credits.cast : [];
    const cast = [];
    for (let i = 0; i < billing.length && cast.length < CAST; i++) {
      if (billing[i] && billing[i].name) cast.push(billing[i].name);
    }
    const score = (payload && typeof payload.vote_average === 'number') ? payload.vote_average : 0;
    return {
      overview: (payload && typeof payload.overview === 'string') ? payload.overview : '',
      runtime: (payload && typeof payload.runtime === 'number') ? payload.runtime : null,
      /* Out of ten, one decimal. Zero is TMDB's "nobody has voted", not a score. */
      rating: score ? Math.round(score * 10) / 10 : null,
      cast: cast
    };
  }

  function url(path, size) { return Config.tmdbImageBase + size + path; }

  /* An episode has no film id of its own, and its show's poster already came
     from Plex for nothing, so it is never looked up. */
  function idOf(item) {
    if (!item || item.type === 'episode') return null;
    return Plex.tmdbId(item);
  }

  function picked(item) {
    const id = idOf(item);
    return id ? (cache[id] || null) : null;
  }

  /* The tile picture, always a poster: TMDB's, else for an episode its show's
     — Plex hands that over as `grandparentThumb`, so it costs no lookup — else
     the item's own thumb. Never a backdrop: 16:9 in a 2:3 box is a smear. */
  function tile(item, w, h) {
    if (!item) return '';
    const got = picked(item);
    if (got && got.poster) return url(got.poster, POSTER_SIZE);
    if (item.type === 'episode') {
      return Plex.photoUrl(Servers.of(item), item.grandparentThumb, w, h) ||
             Plex.posterUrl(item, w, h);
    }
    return Plex.posterUrl(item, w, h);
  }

  /* The backdrop: TMDB's best, else the same Plex fallback the masthead used. */
  function hero(item) {
    const got = picked(item);
    if (got && got.hero) return url(got.hero, HERO_SIZE);
    return Plex.artUrl(item, 1920, 1080) || Plex.posterUrl(item, 1920, 1080);
  }

  /* The description, run time and key actors for a title, or null if TMDB has
     not answered for it yet. Synchronous, like tile() and hero(). */
  function factsFor(item) {
    const got = picked(item);
    return (got && got.facts) || null;
  }

  /* Look this title's artwork up once, then tell the listeners so they can
     repaint. Cheap to call on every draw: a hit, a miss and a request already in
     flight all return without doing anything. */
  function warm(item) {
    const id = idOf(item);
    if (!id || !Tmdb.enabled() || cache[id] || pending[id]) return;
    pending[id] = true;
    queue.push(id);
    pump();
  }

  /* Whoever wants to know a title's art has landed. Called with the TMDB id. */
  function onReady(fn) { listeners.push(fn); }

  function pump() {
    while (active < MAX_IN_FLIGHT && queue.length) {
      active++;
      fetchOne(queue.shift());
    }
  }

  function fetchOne(id) {
    Cached.art.get(id).then((hit) => {
      /* An entry cached before the facts or the poster existed is a miss for
         them, or an old cache would leave a title short of one for ever. */
      if (hit && hit.facts && hit.poster !== undefined) return hit;
      return Tmdb.details(id).then((payload) => {
        const got = pick(payload);
        got.facts = facts(payload);
        Cached.art.put(id, got);
        return got;
      });
    }).then((got) => { landed(id, got); },
            () => { landed(id, { hero: null, poster: null }); });
  }

  /* A title with no usable backdrops is cached too, or an obscure one costs a
     request every time the row is walked past. */
  function landed(id, got) {
    active--;
    delete pending[id];
    cache[id] = got;
    pump();
    for (let i = 0; i < listeners.length; i++) listeners[i](id);
  }

  return { pick: pick, facts: facts, url: url, tile: tile, hero: hero,
           factsFor: factsFor, warm: warm, onReady: onReady };
})();
/* Screen chrome: which view is showing, the toast, the debug line, and the few
   helpers every other module needs. Nothing here knows about Plex. */
var UI = (function () {
  'use strict';

  /* Every full-screen view in index.html. show() hides all of them and reveals
     one; show('player') is a legitimate call that reveals none of them, since
     the video element sits above the lot. */
  const VIEWS = ['browse', 'show', 'detail', 'link', 'message', 'search', 'devices'];

  /* Remote keycodes. The TV sends 461 for Back; a desktop browser sends 8 or
     27, which is what lets the whole app be driven from a keyboard in dev. */
  const KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    OK: 13, RED: 403,
    BACK: 461, ESC: 27, BACKSPACE: 8
  };

  const els = {};
  for (let i = 0; i < VIEWS.length; i++) els[VIEWS[i]] = document.getElementById(VIEWS[i]);

  const elToast = document.getElementById('toast');
  const elDebug = document.getElementById('debug');

  let current = 'browse';
  let toastTimer = null;
  const bootedAt = Date.now();

  function isBack(code) {
    return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE;
  }

  function show(name) {
    current = name;
    for (let n = 0; n < VIEWS.length; n++) {
      els[VIEWS[n]].classList.toggle('hidden', VIEWS[n] !== name);
    }
  }

  function view() { return current; }

  /* The bottom line of the screen. WAM doesn't forward console.log anywhere
     readable on this set, so during bring-up the same text can be posted to a
     listener on the dev machine — see Config.beacon and dev/beacon.js. */
  /* Stamped with the time since launch, so the debug line reads as a timeline
     of the first load — which is the only way to tell a slow server from a slow
     panel without a profiler. */
  function debug(msg) {
    const stamped = (Date.now() - bootedAt) + 'ms  ' + msg;
    elDebug.textContent = stamped;
    if (window.console && console.log) console.log(`REFLEX ${stamped}`);
    if (!Config.beacon) return;
    /* Never let logging break the app: the answer is thrown away, and so is
       any failure to deliver it. */
    Http.request(Config.beacon + '?m=' + encodeURIComponent(msg), { label: 'beacon' })
      .then(null, () => {});
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { elToast.classList.add('hidden'); }, 4000);
  }

  function message(title, body) {
    document.getElementById('message-title').textContent = title;
    document.getElementById('message-body').textContent = body;
    show('message');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  return {
    KEY: KEY, isBack: isBack,
    show: show, view: view, message: message, toast: toast, debug: debug,
    escapeHtml: escapeHtml, clamp: clamp
  };
})();
/* The action icons, drawn as inline SVG.

   The film page and the player each drew their own copy of the same builder
   and three of the same icons, which is how two buttons meaning the same thing
   drift apart. Inline rather than a font: nothing is fetched, and stroke
   follows the text colour, so a focused button needs no second asset. */
var Glyphs = (function () {
  'use strict';

  /* One 46px icon from its inner shapes. */
  function glyph(inner) {
    return '<svg width="46" height="46" viewBox="0 0 256 256" fill="none" ' +
           'stroke="currentColor" stroke-width="16" stroke-linecap="round" ' +
           'stroke-linejoin="round">' + inner + '</svg>';
  }

  return {
    glyph: glyph,

    /* Shared by the film page and the player. */
    audio: glyph('<polygon points="36,100 92,100 148,48 148,208 92,156 36,156"/>' +
                 '<path d="M188 92a52 52 0 0 1 0 72"/>'),
    subs: glyph('<rect x="28" y="52" width="200" height="152" rx="18"/>' +
                '<line x1="64" y1="124" x2="140" y2="124"/>' +
                '<line x1="64" y1="164" x2="192" y2="164"/>'),
    quality: glyph('<line x1="56" y1="196" x2="56" y2="140"/>' +
                   '<line x1="128" y1="196" x2="128" y2="96"/>' +
                   '<line x1="200" y1="196" x2="200" y2="52"/>'),

    /* The film page's own. */
    trailer: glyph('<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/>'),
    source: glyph('<rect x="36" y="44" width="184" height="72" rx="14"/>' +
                  '<rect x="36" y="140" width="184" height="72" rx="14"/>'),
    remove: glyph('<circle cx="128" cy="128" r="100"/>' +
                  '<line x1="84" y1="128" x2="172" y2="128"/>'),

    /* The player's own. */
    rewind: glyph('<polygon points="124,64 124,192 40,128"/>' +
                  '<polygon points="216,64 216,192 132,128"/>'),
    forward: glyph('<polygon points="132,64 132,192 216,128"/>' +
                   '<polygon points="40,64 40,192 124,128"/>'),
    /* Filling their box the way the two jumps either side of them do: the
       buttons were always one size, and a triangle inset in its own box is
       what read as a smaller play than forward. */
    play: glyph('<polygon points="72,48 72,208 208,128"/>'),
    pause: glyph('<line x1="88" y1="52" x2="88" y2="204"/>' +
                 '<line x1="168" y1="52" x2="168" y2="204"/>'),
    chapters: glyph('<rect x="28" y="60" width="200" height="136" rx="18"/>' +
                    '<line x1="96" y1="60" x2="96" y2="196"/>' +
                    '<line x1="160" y1="60" x2="160" y2="196"/>')
  };
})();
/* The list of things to choose from, and the four arrows that walk it.

   Two screens need exactly this: the player, where it is audio, subtitles,
   quality and chapters, and the film page, where it is the copy, the version,
   the track and the subtitles. What each row means, and what choosing it
   costs, belongs to those screens. What is here is the shell — tabs across the
   top, a list that winds to keep the selection in view, and an overlay that
   takes every key while it is up, because a selection nobody can see must not
   be moving behind one. */
var Menu = (function () {
  'use strict';

  const ROW_H = 56;                  // .menu-row, in CSS pixels
  const ROWS_SHOWN = 7;

  let host = null;
  let tabs = [];
  let tab = 0;
  let sel = 0;
  let built = [];
  let onChoose = null;
  let onClose = null;
  let elTabs = null;
  let elInner = null;
  let elNote = null;

  /* A tab's rows are asked for when the tab is shown, not when the menu opens:
     what is on offer depends on where playback has got to, and a list built
     four tabs ago is stale by the time you reach it. */
  function build() {
    const list = tabs[tab] ? tabs[tab].rows() : [];
    built = list.length ? list : [{ label: 'Nothing to choose here', off: true }];
  }

  function rows() { return built; }

  /* Land on what is already in use, so OK on the first press is a no-op rather
     than a surprise. */
  function land() {
    const list = rows();
    sel = 0;
    for (let i = 0; i < list.length; i++) if (list[i].on) { sel = i; return; }
  }

  function paint() {
    const list = rows();
    let html = '';
    let i;
    for (i = 0; i < tabs.length; i++) {
      html += `<span class="menu-tab${i === tab ? ' on' : ''}">` +
              UI.escapeHtml(tabs[i].label) + '</span>';
    }
    elTabs.innerHTML = html;

    html = '';
    for (i = 0; i < list.length; i++) {
      const r = list[i];
      html += `<div class="menu-row${i === sel ? ' sel' : ''}` +
              (r.on ? ' on' : '') + (r.off ? ' off' : '') + '">' +
              '<span class="menu-mark">' + (r.on ? '●' : '') + '</span>' +
              '<span class="menu-label">' + UI.escapeHtml(r.label) + '</span>' +
              (r.note ? `<span class="menu-note-inline">${UI.escapeHtml(r.note)}</span>` : '') +
              '</div>';
    }
    elInner.innerHTML = html;

    /* Keep the selection in view without a scrollbar the remote cannot use. */
    const top = UI.clamp(sel - 3, 0, Math.max(0, list.length - ROWS_SHOWN));
    elInner.style.webkitTransform = elInner.style.transform =
      `translateY(${-top * ROW_H}px)`;
    elNote.textContent = (tabs[tab] && tabs[tab].note) || '';
  }

  /* Draw tabs of [{ label, note, rows }] into host and take the d-pad until a
     row is chosen or BACK closes it. Each tab's rows() returns
     [{ label, note, on, value }]; value is whatever onChoose is to act on. */
  function open(o) {
    host = o.host;
    tabs = o.tabs || [];
    tab = o.tab || 0;
    onChoose = o.onChoose || null;
    onClose = o.onClose || null;
    /* Built once per host and then kept: the winding transition lives on
       .menu-inner, and an element replaced on every paint never runs one. */
    if (!host.firstChild) {
      host.innerHTML = '<div class="menu-tabs"></div>' +
                       '<div class="menu-list"><div class="menu-inner"></div></div>' +
                       '<div class="menu-note"></div>';
    }
    elTabs = host.querySelector('.menu-tabs');
    elInner = host.querySelector('.menu-inner');
    elNote = host.querySelector('.menu-note');
    build();
    land();
    host.classList.remove('hidden');
    paint();
  }

  function close() {
    if (!host) return;
    const done = onClose;
    host.classList.add('hidden');
    host = null; tabs = []; onChoose = null; onClose = null;
    if (done) done();
  }

  function isOpen() { return !!host; }

  /* Closed before the choice is acted on, so a screen that reopens the menu or
     tears itself down in response is not fighting an overlay that is still up. */
  function choose() {
    const r = rows()[sel];
    const go = onChoose;
    close();
    if (r && !r.off && go) go(r.value, r);
  }

  function key(code) {
    const list = rows();
    if (code === 38) { sel = (sel + list.length - 1) % list.length; paint(); return true; }
    if (code === 40) { sel = (sel + 1) % list.length; paint(); return true; }
    if ((code === 37 || code === 39) && tabs.length > 1) {
      tab = (tab + (code === 39 ? 1 : tabs.length - 1)) % tabs.length;
      build();
      land();
      paint();
      return true;
    }
    if (code === 13 || code === 415 || code === 19) { choose(); return true; }
    if (UI.isBack(code) || code === 413) { close(); return true; }
    return true;                       // the menu swallows everything else
  }

  return { open: open, close: close, isOpen: isOpen, key: key };
})();
/* The row model, and nothing else — no DOM, no network.

   Two kinds of row:
     'list'   items are held outright (hubs, Continue watching, search results)
     'merge'  virtual over one or more server sections, merged and deduplicated
              as you scroll

   The merge row is what makes a 30,000 film library browsable across two
   servers: it knows roughly how long it is without crawling anything, holds
   only what you have walked past, and shows one entry per film with every
   copy of it attached. See js/merge.js for the walk itself. */
var Rows = (function () {
  'use strict';

  const PAGE = 100;                // items per request against a server section

  function list(title, items) {
    return { kind: 'list', title: title, items: items, total: items.length, focus: 0 };
  }

  /* parts: [{ server, key, updatedAt, filter, tag }], one per server section.
     fetch(part, offset) -> Promise({ items, total }). */
  function merged(title, parts, fetch) {
    return { kind: 'merge', title: title || 'All films', focus: 0, total: 0,
             parts: parts, state: Merge.stream(parts, fetch) };
  }

  /* Null means "position exists but has not been walked to yet" — the tile
     draws a placeholder rather than a gap. */
  function itemAt(row, i) {
    if (!row || i < 0 || i >= row.total) return null;
    if (row.kind === 'list') return row.items[i];
    return Merge.items(row.state)[i] || null;
  }

  /* How far ahead of the focus to materialise: a screenful, plus enough that
     holding a direction key does not outrun the walk. */
  const LOOKAHEAD = 24;

  function needsUpTo(row) { return row.focus + LOOKAHEAD; }

  function haveUpTo(row) {
    return row.kind === 'merge' ? Merge.items(row.state).length : row.total;
  }

  return { PAGE: PAGE, list: list, merged: merged, itemAt: itemAt,
           needsUpTo: needsUpTo, haveUpTo: haveUpTo, LOOKAHEAD: LOOKAHEAD };
})();

/* The rail: stacked rows of portrait posters, drawn from a fixed pool of elements.

   Nothing here grows with the library. Four row elements and twelve tiles each
   exist for the life of the app; scrolling moves transforms and reassigns
   contents. On a 2018 SoC that is the difference between a rail that keeps up
   with the remote and one that does not.

   Rail draws whatever it is handed and owns no state beyond the pool — see
   js/browse.js for what is in the rows. */
var Rail = (function () {
  'use strict';

  /* 2:3, so seven fit across at 1920: 96 left margin + 7×209 + 6×44 = 1823. */
  const TILE_W = 209;
  const TILE_H = 314;
  const GAP = 44;
  const STRIDE = TILE_W + GAP;
  const ROW_H = 466;               // 44 header + 314 art + 74 two lines + 34 below
  const VIEWPORT_H = 580;          // css #viewport, well below the 264px header
  const TILE_POOL = 12;            // tiles per row element
  const ROW_POOL = 4;              // row elements in the DOM, ever
  const TILES_VISIBLE = 7;         // tiles across at 1920 wide
  const LEAD = 1;                  // tiles kept to the left of the focused one
  /* Two different questions, and answering both with one number clipped the
     last row of every section. ROWS_FIT is how many rows fit *whole* in the
     viewport, and is what stops the window scrolling past the end — get it
     wrong and the final row is pinned half below the fold, title and all.
     ROWS_VISIBLE is how many are on screen at all, including the one peeking
     at the bottom, and is only about which posters are worth fetching. */
  const ROWS_FIT = Math.floor(VIEWPORT_H / ROW_H);
  const ROWS_VISIBLE = ROWS_FIT + 1;   // the last one peeks, so its posters load
  /* The tall hero and the header differ by this much, and the rows carry the
     whole move on one transform rather than anything animating a height. The
     figure is the viewport less one row, so the first screen shows Continue
     watching whole and nothing of the row after it. */
  const BIG_DROP = VIEWPORT_H - ROW_H;
  /* Sweeping a row used to cost a poster and a TMDB lookup per tile passed, all
     of them for tiles already gone by. A tile's cheap parts still draw at once;
     its picture waits this long for the movement to stop. */
  const SETTLE = 160;

  const elRows = document.getElementById('rows');
  const rowEls = [];
  let settleTimer = null;

  function translate(el, x, y) {
    const t = `translate(${x}px,${y}px)`;
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  /* Moving within a row animates; being recycled to a different row must not.
     A pool element carries the last row's scroll position, so letting that
     transition means the row you just stepped onto slides in from wherever you
     had walked to on the one above. Same reason .tile itself never transitions.
     The offsetWidth read commits the jump before the transition comes back —
     without it the browser coalesces both changes and animates anyway. */
  function place(el, x, animate) {
    if (animate) { translate(el, x, 0); return; }
    el.style.transition = 'none';
    el.style.webkitTransition = 'none';
    translate(el, x, 0);
    void el.offsetWidth;
    el.style.transition = '';
    el.style.webkitTransition = '';
  }

  function build() {
    let label;
    let strip;
    let inner;
    let img;
    let name;
    let sub;
    let prog;
    for (let r = 0; r < ROW_POOL; r++) {
      const rowEl = /** @type {RailRowElement} */ (document.createElement('div'));
      rowEl.className = 'row hidden';
      label = document.createElement('div');
      label.className = 'row-label';
      strip = document.createElement('div');
      strip.className = 'strip';
      rowEl.appendChild(label);
      rowEl.appendChild(strip);
      rowEl._label = label; rowEl._strip = strip; rowEl._row = -1;
      rowEl._rowRef = null; rowEl._tiles = []; rowEl._onScreen = false;

      for (let i = 0; i < TILE_POOL; i++) {
        const tile = /** @type {RailTileElement} */ (document.createElement('div'));
        /* Hidden until something is in it — otherwise the pool shows as a
           stack of empty cards for as long as the first rows take to arrive. */
        tile.className = 'tile hidden';
        inner = document.createElement('div');
        inner.className = 'tile-inner';
        img = document.createElement('img');
        img.alt = '';
        prog = document.createElement('div');
        prog.className = 'tile-progress';
        /* The title sits under the art rather than over it: a poster carries
           its own title already, and text on top of it is unreadable. */
        name = document.createElement('div');
        name.className = 'tile-title';
        sub = document.createElement('div');
        sub.className = 'tile-sub';
        inner.appendChild(img);
        inner.appendChild(prog);
        tile.appendChild(inner);
        tile.appendChild(name);
        tile.appendChild(sub);
        tile._img = img; tile._name = name; tile._sub = sub; tile._prog = prog;
        tile._idx = -1; tile._filled = false; tile._item = null; tile._wait = false;
        strip.appendChild(tile);
        rowEl._tiles.push(tile);
      }
      elRows.appendChild(rowEl);
      rowEls.push(rowEl);
    }
    Art.onReady(repaint);
  }

  /* Backdrops arrive after the tile was drawn, so the one tile that was waiting
     for them is reassigned in place. A whole-rail render per image would be far
     more work than one picture is worth. */
  function repaint(tmdbId) {
    let url;
    for (let r = 0; r < ROW_POOL; r++) {
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (!t._item || t._deferred || t._wait || Plex.tmdbId(t._item) !== tmdbId) continue;
        url = Art.tile(t._item, TILE_W, TILE_H);
        if (url) t._img.src = url;
      }
    }
  }

  /* A tile showing a placeholder must re-render once its page lands. One that
     already shows a poster must not, or we reassign src for nothing. */
  function invalidateEmpty() {
    for (let r = 0; r < ROW_POOL; r++) {
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (!t._filled || t._deferred) t._idx = -1;
      }
    }
  }

  /* The expensive half of a tile: the lookup and the picture. Art decides
     between TMDB and Plex, so only a tile worth looking at is worth calling on. */
  function paint(tile) {
    tile._wait = false;
    Art.warm(tile._item);
    const url = Art.tile(tile._item, TILE_W, TILE_H);
    if (url) tile._img.src = url; else tile._img.removeAttribute('src');
  }

  /* The rail has stopped moving, so the tiles still on it can have their
     pictures. Off-screen rows keep waiting — they have their own reason to. */
  function settled() {
    for (let r = 0; r < ROW_POOL; r++) {
      if (!rowEls[r]._onScreen) continue;
      for (let i = 0; i < TILE_POOL; i++) {
        const t = rowEls[r]._tiles[i];
        if (t._wait && t._item) paint(t);
      }
    }
  }

  function drawRow(rowEl, rows, r, rowIdx, onScreen) {
    /* Position alone does not identify a row: search results replace the rows
       in place and keep rowIdx 0, so a pool element holding row 0 went on
       showing the library's row 0 — right title over the wrong tiles. */
    const row = rows[r];
    const reused = rowEl._row !== r || rowEl._rowRef !== row;
    let i;
    let idx;
    let item;
    let held;
    let focused;
    let firstVisible;
    let start;

    rowEl._onScreen = onScreen;
    rowEl.classList.remove('hidden');
    translate(rowEl, 0, r * ROW_H);
    rowEl.classList.toggle('on', r === rowIdx);

    if (reused) {
      rowEl._row = r;
      rowEl._rowRef = row;
      rowEl._label.textContent = row.title;
      for (i = 0; i < TILE_POOL; i++) { rowEl._tiles[i]._idx = -1; rowEl._tiles[i]._filled = false; }
    }
    /* A merged row's length is an estimate until it has been walked, so the
       count is re-read on every paint rather than only when the row is reused. */
    if (row.kind === 'merge') {
      rowEl._label.textContent = row.title + (row.total ? `  (${row.total})` : '');
    }

    firstVisible = UI.clamp(row.focus - LEAD, 0, Math.max(0, row.total - TILES_VISIBLE));
    start = UI.clamp(firstVisible - 2, 0, Math.max(0, row.total - TILE_POOL));
    place(rowEl._strip, -firstVisible * STRIDE, !reused);

    for (i = 0; i < TILE_POOL; i++) {
      const tile = rowEl._tiles[i];
      idx = start + i;
      if (idx >= row.total) { tile.classList.add('hidden'); tile._idx = -1; tile._item = null; continue; }
      tile.classList.remove('hidden');
      translate(tile, idx * STRIDE, 0);
      focused = r === rowIdx && idx === row.focus;
      tile.classList.toggle('on', focused);
      /* A tile whose poster was skipped has to be redrawn when its row comes
         into view, so the short circuit has to know about that. */
      if (tile._idx === idx && !(tile._deferred && onScreen)) {
        /* Nothing else changed, but the focus can arrive on a tile still
           waiting for its picture, and that one never waits. */
        if (focused && tile._wait) paint(tile);
        continue;
      }
      tile._idx = idx;
      item = Rows.itemAt(row, idx);
      /* A slot in the pool is not an identity. Sweeping hands this element the
         item its neighbour was showing, and keeping the picture then draws one
         film's poster over another film's title until the settle catches up. */
      held = !!item && item === tile._item;
      tile._filled = !!item;
      tile._item = item;
      if (!item) {
        tile._name.textContent = '';
        tile._sub.textContent = '';
        tile._prog.style.width = '0';
        tile._img.removeAttribute('src');
        continue;
      }
      tile._name.textContent = Media.railTitle(item);
      tile._sub.textContent = Media.railSub(item);
      tile._prog.style.width = (item.viewOffset && item.duration)
        ? Math.round(100 * item.viewOffset / item.duration) + '%' : '0';
      /* Rows below the fold get their titles but not their posters. On a first
         run every poster is generated on demand by a server we do not own, so
         asking for two screens' worth before the first one has painted is the
         single most expensive thing this app does. They load when scrolled to. */
      if (!onScreen) {
        tile._deferred = true;
        tile._wait = false;
        tile._img.removeAttribute('src');
        continue;
      }
      tile._deferred = false;
      /* The focused tile is the one being looked at and the one the hero is
         about to draw, so it pays immediately. The rest wait for the movement
         to settle: one still holding the same item keeps its picture, and one
         that has been handed a different film shows the surface colour rather
         than the film it used to be. */
      tile._wait = !focused;
      if (focused) paint(tile);
      else if (!held) tile._img.removeAttribute('src');
    }
  }

  function render(rows, rowIdx) {
    /* Rows of context kept above the focused one — every row that fits bar the
       focused one itself. A portrait row leaves room for exactly one, so this
       is zero now and the focused row sits at the top; typed as 1 it would draw
       the row you just moved to half below the fold. */
    const firstVisible = UI.clamp(rowIdx - (ROWS_FIT - 1), 0, Math.max(0, rows.length - ROWS_FIT));
    const start = UI.clamp(firstVisible, 0, Math.max(0, rows.length - ROW_POOL));
    /* Row 0 sits under the tall hero; everything below it sits under the band.
       Both states are one translate on this element, so the collapse animates
       for free on the transform that was moving anyway. */
    translate(elRows, 0, (rowIdx === 0 ? BIG_DROP : 0) - firstVisible * ROW_H);
    for (let i = 0; i < ROW_POOL; i++) {
      const r = start + i;
      if (r >= rows.length) {
        rowEls[i].classList.add('hidden');
        rowEls[i]._row = -1;
        rowEls[i]._onScreen = false;
        continue;
      }
      drawRow(rowEls[i], rows, r, rowIdx, r < firstVisible + ROWS_VISIBLE);
    }
    /* One timer for the whole rail, restarted by every render: a sweep resets
       it on each key and the pictures arrive once, when it stops. */
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settled, SETTLE);
  }

  return { build: build, render: render, invalidateEmpty: invalidateEmpty };
})();
/* Full metadata for a copy of a film, cached.

   The masthead has to show which audio track we would pick *before* the user
   presses OK, and that only comes from /library/metadata — the list endpoints
   carry no streams. So every focused item needs a fetch, which makes this the
   one place in the app that could hammer servers we do not own. Hence: a
   debounce on the focus, an IndexedDB layer under the memory cache, and a cap
   on what is held in RAM.

   Keys are per server: the same film on two servers has two rating keys, two
   metadata payloads, and — the whole point — two different sets of streams. */
var Meta = (function () {
  'use strict';

  const CAP = 500;                 // metadata payloads kept in RAM
  const HOLD = 280;                // ms of stillness before asking a server

  let cache = {};
  let count = 0;
  let timer = null;

  function keyOf(item) {
    return (item && item._server ? item._server : '?') + ':' + (item && item.ratingKey);
  }

  function get(item) { return cache[keyOf(item)] || null; }

  function remember(key, md) {
    /* ponytail: crude cap, drop the lot when it fills. A 30k library browsed
       hard would otherwise grow this without bound. LRU if it ever matters. */
    if (count > CAP) { cache = {}; count = 0; }
    cache[key] = md;
    count++;
  }

  function load(item) {
    if (!item || !item.ratingKey) return Promise.resolve(null);
    const key = keyOf(item);
    if (cache[key]) return Promise.resolve(cache[key]);
    const server = Servers.of(item);
    if (!server) return Promise.resolve(null);

    return fetchOne(key, server, item);
  }

  async function fetchOne(key, server, item) {
    try {
      let md = await Cached.meta.get(key);
      if (!md) {
        md = await Plex.metadata(server, item.ratingKey);
        if (md) Cached.meta.put(key, md);
      }
      if (md) {
        md._server = item._server;          // survives the round trip through Store
        remember(key, md);
      }
      return md;
    } catch (e) {
      UI.debug(`meta: ${e.message}`);
      return null;
    }
  }

  /* Fetch for whatever is focused now, once the user stops moving. onLoaded is
     called with the rating key so the caller can check it is still the focused
     one before repainting. */
  function schedule(item, onLoaded) {
    clearTimeout(timer);
    if (!item) return;
    /* Already held: the caller drew the badge from the cache a moment ago, so
       there is nothing to fetch and nothing to repaint. */
    if (cache[keyOf(item)]) return;
    const ratingKey = item.ratingKey;
    timer = setTimeout(() => {
      load(item).then((md) => { if (md) onLoaded(ratingKey, md); });
    }, HOLD);
  }

  return { get: get, load: load, schedule: schedule };
})();
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
  /* forceAudioId overrides the choice — that is how switching track in the
     player works, since the ranking would otherwise just pick the same one
     again. */
  /* opts.maxBitrate is the quality menu in the player. Asking for a cap is
     asking the server to re-encode, so the decision comes back 'transcode' —
     which on a 4K file is a refusal, arrived at by the ordinary rule rather
     than by a special case.

     opts.forceStream is the same shape of thing for audio: a direct play hands
     the panel the whole file and the panel picks its own track, so being given
     a chosen track means giving up direct play. On a 4K file that is refused
     too, by the same rule — which is the honest answer, because the server
     would be muxing a 4K stream and that is what gets killed. */
  function check(item, mediaIndex, forceAudioId, opts) {
    const n = mediaIndex || 0;
    opts = opts || {};
    return Meta.load(item).then((md) => {
      if (!md) return { ok: false, state: 'nometa', text: 'No metadata for this copy.' };

      const media = md.Media && md.Media[n];
      const part = media && media.Part && media.Part[0];
      if (!part) {
        return { ok: false, state: 'nopart', md: md, media: media, mediaIndex: n,
                 text: 'This version has no playable part.' };
      }

      /* The track that passes as-is if there is one, otherwise the film's own
         audio and the server re-encodes it. */
      let passes = Media.pickAudio(part);
      let audio = passes || Media.bestAudio(part);
      if (forceAudioId) {
        const wanted = Media.streamById(part, forceAudioId);
        if (wanted) { audio = wanted; passes = Media.pickAudio(part) === wanted; }
      }
      if (!audio) {
        return { ok: false, state: 'noaudio', md: md, media: media, part: part,
                 mediaIndex: n, audio: null, text: Media.audioSummary(part) };
      }

      const server = Servers.of(md);
      return Plex.decide(server, md, n, 0, audio.id, opts).then((v) => {
        const direct = v.decision === 'directplay';
        const uhd = Media.isUHD(media);
        /* Only direct play hands the panel the original file. A re-encode
           arrives as H.264, which it always manages — so this check belongs
           here, not before the decision. */
        const undecodable = direct && !Media.canDecode(media);
        const willing = Media.allows(media, direct);
        UI.debug(`decision: ${v.decision} · ${md.title}` +
                 (Servers.count() > 1 ? ` on ${server.name}` : '') +
                 ' · ' + Media.audioLabel(audio) +
                 (v.video || v.audio ? ` · v:${v.video || '?'} a:${v.audio || '?'}` : '') +
                 ' ' + v.text);
        return {
          /* 4K must direct play or not play. Anything else may transcode. */
          ok: willing,
          state: undecodable ? 'codec' : v.decision,
          transcode: !direct,
          video: v.video, audioDecision: v.audio,
          audio: audio, passes: !!passes,
          maxBitrate: opts.maxBitrate || null,
          forceStream: !!opts.forceStream,
          md: md, media: media, part: part, mediaIndex: n,
          text: v.text || ''
        };
      }, (e) => {
        return { ok: false, state: 'error', md: md, media: media, part: part,
                 mediaIndex: n, audio: audio, text: e.message };
      });
    }, (e) => {
      return { ok: false, state: 'error', text: e.message };
    });
  }

  /* A short label for a verdict, for the source list. */
  function label(v) {
    if (!v) return 'checking…';
    if (v.ok && !v.transcode) return 'direct play';
    if (v.ok) {
      /* Not a direct play, but nothing is being re-encoded either: the server
         is muxing the file's own streams into a container, which is what
         choosing an audio track costs. Worth its own name — calling a remux a
         transcode is how you end up avoiding something that was cheap. */
      if (v.video === 'copy' && v.audioDecision === 'copy') return 'direct stream';
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
      const status = /-> (\d{3})/.exec(v.text || '');
      return status ? `server said ${status[1]}` : 'check failed';
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

    const why = v.text || (`the server returned "${v.state}"`);
    /* The only thing still refused outright. */
    return ['4K transcode refused', item.title + ' will not direct play — ' + why +
      '. Starting it would register a 4K transcode on the server, which gets ' +
      'killed mid-stream. Another copy may direct play — check the list. Or run ' +
      'probe.py against this file to find which declared capability flips it.'];
  }

  return { check: check, label: label, refusal: refusal };
})();
/* Seasons and episodes, merged across servers.

   A show entry from the rail is already merged — it carries a copy of the show
   from each server that has it. Drilling in means asking each of those servers
   for its own children and merging those too, at both levels: a season is one
   season however many servers hold it, and so is an episode.

   Nothing here fetches a whole library. One show, one season at a time. */
var Shows = (function () {
  'use strict';

  const entries = {};              // '<server>:<showKey>' -> Promise<entry|null>

  /* Seasons of a merged show entry, in order.
     Each returned season carries its own per-server copies, which is what the
     episode fetch then walks. */
  function seasons(entry) {
    const copies = Merge.sources(entry);
    return Promise.all(copies.map((copy) => {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then((perServer) => {
      const merged = Merge.lists(perServer.map((list) => {
        return list.filter((m) => { return m.type === 'season'; });
      }));
      merged.sort((a, b) => { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* Episodes of a merged season, in order. */
  function episodes(season) {
    const copies = Merge.sources(season);
    return Promise.all(copies.map((copy) => {
      return Plex.children(Servers.of(copy), copy.ratingKey);
    })).then((perServer) => {
      const merged = Merge.lists(perServer.map((list) => {
        return list.filter((m) => { return m.type === 'episode'; });
      }));
      merged.sort((a, b) => { return (a.index || 0) - (b.index || 0); });
      return merged;
    });
  }

  /* The series an episode belongs to, merged across every server that has it,
     or null if it cannot be resolved. Cached per show, because pressing OK on
     three episodes of one show must cost one resolution. */
  function entryFor(episode) {
    if (!episode || !episode.grandparentRatingKey) return Promise.resolve(null);
    const key = episode._server + ':' + episode.grandparentRatingKey;
    if (!entries[key]) entries[key] = resolve(episode);
    return entries[key];
  }

  function resolve(episode) {
    return Meta.load({ ratingKey: episode.grandparentRatingKey,
                       _server: episode._server }).then((md) => {
      if (!md) return null;
      /* Up to the show and out from there: episodes rarely carry ids of their
         own, but the show does, so its ids are what the other servers are asked
         for. Its own server's copy leads the fold, so a show only one server
         has is simply a one-source entry and the page is happy with that. */
      return Promise.all(Servers.all().map((sv) => {
        return Plex.allVersions(sv, md);
      })).then((perServer) => {
        return Merge.lists([[md]].concat(perServer))[0];
      });
    }).catch(() => { return null; });
  }

  /* Is this merged entry a copy of that episode? Matched by rating key across
     every copy, because the episode playing is one server's and the merged
     entry may lead with the other's. */
  function isCopyOf(entry, episode) {
    const copies = Merge.sources(entry);
    for (let i = 0; i < copies.length; i++) {
      if (String(copies[i].ratingKey) === String(episode.ratingKey)) return true;
    }
    return false;
  }

  /* The episode after `current` in a season's list, or null at the end of it or
     when `current` is not in the list at all. Pure, so it is unit tested. */
  function nextInList(episodes, current) {
    if (!episodes || !current) return null;
    for (let i = 0; i < episodes.length; i++) {
      if (isCopyOf(episodes[i], current)) return episodes[i + 1] || null;
    }
    return null;
  }

  /* What follows an episode: the next in its season, else the first of the next
     season, or null once the series is over. newSeason is what stops an
     unattended chain rolling across a season boundary. */
  function nextAfter(episode) {
    if (!episode) return Promise.resolve(null);
    return entryFor(episode).then((entry) => {
      if (!entry) return null;
      return seasons(entry).then((list) => {
        let at = -1;
        for (let i = 0; i < list.length; i++) {
          if (list[i].index === episode.parentIndex) { at = i; break; }
        }
        if (at < 0) return null;
        return episodes(list[at]).then((eps) => {
          const next = nextInList(eps, episode);
          if (next) return { episode: next, newSeason: false };
          /* seasons() is sorted by index, so the one after is simply the next. */
          if (at + 1 >= list.length) return null;
          return episodes(list[at + 1]).then((more) => {
            return more.length ? { episode: more[0], newSeason: true } : null;
          });
        });
      });
    }).catch(() => { return null; });
  }

  /* "4 series · 38 episodes", or as much of it as the server told us. */
  function summary(entry) {
    const bits = [];
    if (entry.childCount) {
      bits.push(entry.childCount + ' series');
    }
    if (entry.leafCount) {
      bits.push(entry.leafCount + ' episode' + (entry.leafCount === 1 ? '' : 's'));
    }
    if (entry.leafCount && entry.viewedLeafCount) {
      bits.push(entry.viewedLeafCount + ' watched');
    }
    return bits.join('   ·   ');
  }

  /* The season a merged season list should open on: the first with anything
     unwatched, else the first. Somebody part way through series three does not
     want to land on series one every time. */
  function openAt(list) {
    for (let i = 0; i < list.length; i++) {
      if ((list[i].leafCount || 0) > (list[i].viewedLeafCount || 0)) return i;
    }
    return 0;
  }

  return { seasons: seasons, episodes: episodes, entryFor: entryFor,
           nextInList: nextInList, nextAfter: nextAfter,
           summary: summary, openAt: openAt };
})();
/* The hero over the rail: the backdrop, the title, the line under it, and what
   the film is about with who is in it.

   No verdict here any more. Working out whether a copy will play means a
   metadata fetch per item you rest on, against a server we do not own, to
   answer a question you cannot act on until OK — and the detail page answers it
   properly, per copy, where the choice is actually made. */
var Masthead = (function () {
  'use strict';

  const elRow = document.getElementById('mh-row');
  const elTitle = document.getElementById('mh-title');
  const elMeta = document.getElementById('mh-meta');
  const elDesc = document.getElementById('mh-desc');
  const elCast = document.getElementById('mh-cast');
  /* The backdrop is two stacked layers; the one carrying .on is the one you see,
     and a new picture is written into the other and faded up over it. */
  const artLayers = [document.getElementById('hero-art-a'),
                   document.getElementById('hero-art-b')];
  let shown = 0;
  /* Long enough that sweeping a row never starts a full-screen image, short
     enough that a deliberate step still feels answered. */
  const HOLD = 420;                // ms of stillness before asking for a backdrop
  let artTimer = null;
  let artWant = null;
  let lastArt = '';

  /* The backdrop, debounced: only the last item asked for is drawn, so sweeping
     a row costs one full-screen image rather than one per key. */
  function art(item) {
    artWant = item;
    clearTimeout(artTimer);
    artTimer = setTimeout(paintArt, HOLD);
  }

  function paintArt() {
    Art.warm(artWant);
    const url = Art.hero(artWant);
    if (!url || url === lastArt) return;
    lastArt = url;

    /* Swap only once the picture is decoded, or the fade reveals an empty box.
       A broken URL swaps anyway, so it cannot leave the old one up for ever;
       a swap the next backdrop has already overtaken is dropped. */
    const next = artLayers[shown ? 0 : 1];
    const pre = new Image();
    pre.onload = pre.onerror = () => {
      if (lastArt !== url) return;
      next.style.backgroundImage = `url("${url}")`;
      artLayers[shown].classList.remove('on');
      next.classList.add('on');
      shown = shown ? 0 : 1;
    };
    pre.src = url;
  }

  /* A backdrop that lands after the debounce fired belongs on screen only if
     the item it belongs to is still the one being rested on. */
  Art.onReady((tmdbId) => {
    if (!artWant || Plex.tmdbId(artWant) !== tmdbId) return;
    paintArt();
    paintFacts(artWant);
  });

  /* The description and the top of the billing, out of the one TMDB request the
     backdrop already cost. Plex's own summary stands in until it lands, so the
     header never blanks while waiting, and an empty cast draws no line at all
     rather than a label with nothing after it. */
  function paintFacts(item) {
    const got = Art.factsFor(item);
    elDesc.textContent = (got && got.overview) || item.summary || '';
    elCast.textContent = (got && got.cast.length) ? got.cast.join('  \u00b7  ') : '';
  }

  function render(row, item, hasRows) {
    elRow.textContent = (row && row.title) || '';

    if (!item) {
      elTitle.textContent = hasRows ? '\u2026' : 'Loading\u2026';
      elMeta.textContent = '';
      elDesc.textContent = '';
      elCast.textContent = '';
      return;
    }

    /* The same two rules the tile under it uses, so the hero names the show and
       the line beneath says which episode — not the other way round. */
    elTitle.textContent = Media.railTitle(item);
    /* A Discovery title says whether we hold it instead: it has no run time to
       show until it has been resolved, and whether we have it is the fact you
       need before pressing OK. */
    elMeta.textContent = item._availability || Media.railSub(item);
    paintFacts(item);
  }

  return { render: render, art: art };
})();
/* The page between the rail and playback.

   The rail shows one entry per film. This is where that entry opens out: the
   things you want before committing two hours — rating, cast, what it is about
   — and then a row of buttons that decide what pressing Play actually plays.

   Four of those are choices, and none of them is cosmetic. The copy is two
   dimensions, not one: the same film is often on both servers, and a single
   library item can itself hold several versions (a 4K remux and a 1080p encode
   are two entries in Media[]). The quality, the audio track and the subtitle
   language then sit on top of whichever copy is chosen. Every combination goes
   back through js/guard.js before it is accepted, so a choice that would push a
   4K transcode onto someone else's server is refused here rather than found out
   by starting one — and a refusal leaves the previous choice standing.

   The preferred server's copy is selected when the page opens — see
   Servers.preferred. */
var Detail = (function () {
  'use strict';

  const elView = document.getElementById('detail');
  const elArt = document.getElementById('dt-art');
  const elKicker = document.getElementById('dt-kicker');
  const elTitle = document.getElementById('dt-title');
  const elChips = document.getElementById('dt-chips');
  const elRatings = document.getElementById('dt-ratings');
  const elTagline = document.getElementById('dt-tagline');
  const elSummary = document.getElementById('dt-summary');
  const elNames = document.getElementById('dt-names');
  const elCrew = document.getElementById('dt-crew');
  const elActions = document.getElementById('dt-actions');
  const elMenu = document.getElementById('dt-menu');
  const elExtras = document.getElementById('dt-extras');
  const elExtrasLabel = document.getElementById('dt-extras-label');
  const elCast = document.getElementById('dt-cast');

  /* Inlined, like the search icon in index.html: the app runs from file:// on
     the TV, so there is no icon font to fetch. */
  const STAR_GLYPH =
    '<svg class="dt-glyph" width="22" height="22" viewBox="0 0 256 256" fill="none" ' +
    'stroke="currentColor" stroke-width="18" stroke-linejoin="round">' +
    '<polygon points="128,24 158,94 234,101 177,152 194,228 128,188 62,228 79,152 22,101 98,94"/>' +
    '</svg>';
  const PLAY_GLYPH =
    '<svg class="dt-extra-play" width="52" height="52" viewBox="0 0 256 256" fill="none" ' +
    'stroke="currentColor" stroke-width="16" stroke-linejoin="round">' +
    '<circle cx="128" cy="128" r="100"/><polygon points="106,84 178,128 106,172"/></svg>';


  let item = null;                 // the merged entry
  let copies = [];                 // one per server that has it
  let sources = [];                // flattened: one per server × version
  let extras = [];                 // trailers and the rest, playable in their own right
  let sel = 0;                     // which source Play would use
  let strip = 0;                   // 0 = the action row, 1 = the extras
  let idx = 0;                     // within that row
  let headMd = null;               // the first copy's metadata: what the header says
  let onDeck = false;              // is this in Continue watching, and so clearable
  let opts = {};
  let generation = 0;

  /* The combination Play would start: the guard's verdict for it, and the three
     things the buttons can change about it. */
  let verdict = null;
  let chosenAudio = null;
  let chosenSub = null;
  let maxBitrate = null;
  let forceStream = false;

  function open(entry, options) {
    if (!entry) return;
    item = entry;
    opts = options || {};
    generation++;

    /* Merge already put the preferred server's copy first, so source 0 is the
       one the preference asks for. */
    copies = Merge.sources(entry).map((copy) => {
      return { item: copy, server: Servers.of(copy), versions: null };
    });
    extras = [];
    onDeck = Browse.isOnDeck(entry);
    strip = 0;
    idx = 0;
    verdict = null; chosenAudio = null; chosenSub = null;
    maxBitrate = null; forceStream = false;
    rebuild();

    UI.show('detail');
    paintSkeleton();
    render();
    loadDetails();
  }

  function close() {
    /* Metadata and verdicts for the page we are leaving are still in flight;
       moving the generation on is what stops them drawing into an empty page. */
    generation++;
    Menu.close();
    item = null;
    copies = [];
    sources = [];
    extras = [];
    verdict = null;
    if (opts.onExit) opts.onExit();
  }

  /* ---------- the copies ---------- */

  /* Until a copy's metadata lands we know it has *a* version, from the list
     response, but not how many. So each copy contributes one provisional line
     that becomes one line per version once we know. */
  function rebuild() {
    const chosen = sources[sel] || null;
    sources = [];
    copies.forEach((copy) => {
      if (copy.versions) {
        copy.versions.forEach((v) => { sources.push(v); });
        return;
      }
      sources.push({ copy: copy, server: copy.server, mediaIndex: 0,
                     media: (copy.item.Media && copy.item.Media[0]) || {},
                     verdict: null, provisional: true });
    });
    /* Keep the user's choice pinned across a rebuild. */
    sel = 0;
    if (chosen) {
      for (let i = 0; i < sources.length; i++) {
        if (sources[i].copy === chosen.copy && sources[i].mediaIndex === chosen.mediaIndex) {
          sel = i;
          break;
        }
      }
    }
  }

  /* The copies we started with came from the row, which only ever knew about
     one section. These libraries keep the 4K version of a film in a section of
     its own, so the other versions are separate library items and only a guid
     lookup across the whole server finds them. */
  function addOtherVersions(md) {
    const gen = generation;
    const known = {};
    copies.forEach((c) => { known[c.item._server + ':' + c.item.ratingKey] = true; });

    Servers.all().forEach((sv) => {
      Plex.allVersions(sv, md).then((found) => {
        if (gen !== generation || !found.length) return;
        let added = 0;
        found.forEach((other) => {
          const key = other._server + ':' + other.ratingKey;
          if (known[key]) return;
          known[key] = true;
          added++;
          copies.push({ item: other, server: Servers.of(other), versions: null });
          Meta.load(other).then((omd) => {
            if (gen !== generation || !omd) return;
            expand(copies.find((c) => { return c.item === other; }), omd);
          });
        });
        if (added) {
          UI.debug(`found ${added} more version${added === 1 ? '' : 's'}` +
                   ' of ' + md.title + ' on ' + sv.name);
          rebuild();
          render();
        }
      });
    });
  }

  /* Trailers and behind-the-scenes clips come nested in the film's metadata,
     carrying their own media. They are ordinary parts on the same server, so
     they go through the same guard as the film — a clip that would transcode
     is still a transcode on someone else's hardware. */
  function addExtras(md) {
    if (extras.length || !md.Extras || !md.Extras.Metadata) return;
    extras = md.Extras.Metadata.slice(0, 6).map((x) => {
      return { copy: { item: x }, server: Servers.of(x), mediaIndex: 0,
               media: (x.Media && x.Media[0]) || {},
               title: x.title || 'Extra', kind: x.subtype || x.extraType || '',
               verdict: null, isExtra: true };
    });
    render();
    extras.forEach(check);
  }

  function expand(copy, md) {
    const list = (md.Media && md.Media.length ? md.Media : [null]);
    copy.versions = list.map((media, n) => {
      return { copy: copy, server: copy.server, mediaIndex: n, media: media || {},
               verdict: null, provisional: false };
    });
    rebuild();
    render();
    copy.versions.forEach(check);
  }

  /* Every version of every copy is checked as the page opens. hasMDE=1 opens no
     session, so asking about one you end up not playing costs a query and
     nothing else. */
  function check(src) {
    const gen = generation;
    Guard.check(src.copy.item, src.mediaIndex).then((v) => {
      if (gen !== generation) return;
      src.verdict = v;
      render();
    });
  }

  /* Nobody has chosen anything yet, so the selected copy's own verdict is what
     Play would use — including a refusal, which Play then explains in full. */
  function adoptDefault() {
    const src = sources[sel];
    if (verdict || !src || !src.verdict) return;
    verdict = src.verdict;
    chosenAudio = src.verdict.audio || null;
  }

  /* ---------- choosing ----------

     Every button on the row is the same move: ask the guard about the new
     combination, and keep it only if the answer is yes. Losing your place to
     deliver a message is a worse answer than not switching, so a refusal is a
     toast and the page does not move. */
  function choose(next) {
    const gen = generation;
    const src = sources[next.sel];
    if (!src) return;
    Guard.check(src.copy.item, src.mediaIndex, next.audio && next.audio.id,
                { maxBitrate: next.maxBitrate, forceStream: next.forceStream })
      .then((v) => {
        if (gen !== generation) return;
        if (!v.ok) {
          UI.toast(`Kept as it was — ${Guard.label(v)}`);
          UI.debug(`choice refused: ${Guard.refusal(item, v)[1]}`);
          return;
        }
        /* By stream id on the copy we came from, so a subtitle language chosen
           here survives a move to a different file with different ids. */
        chosenSub = chosenSub ? Media.pickSubtitle(v.part, chosenSub.languageCode) : null;
        sel = next.sel;
        chosenAudio = next.audio || v.audio;
        maxBitrate = next.maxBitrate || null;
        forceStream = !!next.forceStream;
        verdict = v;
        render();
      });
  }

  /* ---------- the action row ---------- */

  /* The track the guard picks for a copy on its own — anything else is the
     user's, and costs direct play unless the panel can select it. */
  function defaultAudio() {
    const base = sources[sel] && sources[sel].verdict;
    return (base && base.audio) || null;
  }

  /* Whether this pipeline exposes audioTracks, which is the whole difference
     between switching a track for nothing and asking the server to mux one. */
  function panelOwnsAudio() {
    return Panel.features().audioTracks !== 'no';
  }

  function part() { return verdict && verdict.part; }

  function sourceRows() {
    return sources.map((src, n) => {
      let name = (src.server && src.server.name) || 'server';
      if (Servers.count() > 1 && Servers.isPreferred(src.server)) name += ' · preferred';
      return { label: Media.versionLabel(src.media) + ' · ' + name,
               note: Guard.label(src.verdict),
               on: n === sel, value: n };
    });
  }

  function qualityRows() {
    const media = sources[sel] && sources[sel].media;
    return Media.qualities(media).map((q) => {
      return { label: q.label,
               note: q.bitrate && Media.isUHD(media)
                 ? 'a 4K transcode is what gets the stream killed — this will be refused' : '',
               on: (q.bitrate || null) === maxBitrate,
               value: q.bitrate || null };
    });
  }

  /* Would choosing this track mean giving up direct play? Only when the panel
     cannot select tracks out of the file itself and this is not the track the
     guard picks anyway — the note and the guard call are both this, so what the
     row says before OK is what OK does. */
  function needsMux(st) {
    if (panelOwnsAudio()) return false;
    const base = defaultAudio();
    return !(base && String(base.id) === String(st.id));
  }

  function audioRows() {
    return Media.audioTracks(part()).map((st) => {
      const on = !!(chosenAudio && String(chosenAudio.id) === String(st.id));
      return { label: Media.audioMenuLabel(st),
               note: on ? '' : (needsMux(st) ? 'costs direct play — the server would mux it'
                                             : 'keeps direct play'),
               on: on, value: st };
    });
  }

  function subRows() {
    const out = [{ label: 'Off', on: !chosenSub, value: null }];
    Media.subtitleTracks(part()).forEach((st) => {
      out.push({ label: Media.subLabel(st),
                 note: Media.isTextSub(st) ? '' : 'image track — it would have to be burnt in',
                 on: !!(chosenSub && String(chosenSub.id) === String(st.id)),
                 value: st });
    });
    return out;
  }

  /* "1:12", from seconds — where a part-watched film would pick up. */
  function atLabel(secs) {
    const mins = Math.floor(secs / 60);
    return Math.floor(mins / 60) + ':' + (mins % 60 < 10 ? '0' : '') + (mins % 60);
  }

  /* Where Play would pick up, in seconds, and 0 when there is nothing worth
     resuming — the first ten seconds of a film are not a position. */
  function resumeAt() {
    const at = (item && item.viewOffset) || 0;
    return at > 10000 ? Math.floor(at / 1000) : 0;
  }

  /* Play says what it will do and what it will cost, because both are decided
     by the buttons beside it. */
  function playCaption() {
    const at = resumeAt();
    return (at ? `resume at ${atLabel(at)}` : 'from start') +
           '  ·  ' + (verdict ? Guard.label(verdict) : 'checking…');
  }

  function sourceCaption() {
    const src = sources[sel];
    return (src && src.server && src.server.name) || 'checking…';
  }

  function qualityCaption() {
    if (maxBitrate) return Media.bitrateLabel(maxBitrate) + ' converted';
    return Media.versionLabel(sources[sel] && sources[sel].media);
  }

  /* Getting this out of Continue watching, which the row does for several at a
     time and this does for one. On success there is nothing left to say about
     it here, so the page closes onto the rail it has already been dropped
     from. */
  function removeFromDeck() {
    Browse.clearOne(item, () => { onDeck = false; close(); });
  }

  /* Eight at most: Play, starting again where there is something to resume,
     then the extras, then the three things about the copy that can be chosen.
     Trailer is only here when there is one, and Remove only when the thing is
     actually on the deck. */
  function actions() {
    const out = [{ act: 'play', label: 'Play', primary: true, caption: playCaption(),
                 run: () => { start(verdict, false); } }];
    /* Part way through, resuming and starting again are two different things to
       want. Both are the verdict the buttons already settled — the second only
       says where to begin. */
    if (resumeAt()) {
      out.push({ act: 'start', label: 'From start', primary: true, quiet: true,
                 caption: verdict ? Guard.label(verdict) : 'checking…',
                 run: () => { start(verdict, false, 0); } });
    }
    if (extras.length) {
      out.push({ act: 'trailer', glyph: Glyphs.trailer, caption: extras[0].title,
                 run: () => { start(extras[0].verdict, true); } });
    }
    out.push({ act: 'quality', glyph: Glyphs.quality, caption: qualityCaption(),
               run: openQuality });
    out.push({ act: 'source', glyph: Glyphs.source, caption: sourceCaption(),
               run: openSource });
    out.push({ act: 'audio', glyph: Glyphs.audio, run: openAudio,
               caption: chosenAudio ? Media.audioLabel(chosenAudio) : 'checking…' });
    out.push({ act: 'subtitles', glyph: Glyphs.subs, caption: Media.subLabel(chosenSub),
               run: openSubs });
    if (onDeck) {
      out.push({ act: 'remove', glyph: Glyphs.remove, run: removeFromDeck,
                 caption: 'Remove from Continue watching' });
    }
    return out;
  }

  function renderActions() {
    const list = actions();
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      html += `<div class="dt-act${a.primary ? ' primary' : ''}` +
              (a.quiet ? ' quiet' : '') +
              (strip === 0 && i === idx ? ' on' : '') + '" data-act="' + a.act + '">' +
              '<div class="dt-act-btn">' + (a.glyph || UI.escapeHtml(a.label)) + '</div>' +
              '<div class="dt-act-cap">' + UI.escapeHtml(a.caption) + '</div>' +
              '</div>';
    }
    elActions.innerHTML = html;
  }

  /* The chooser sits under the button that opened it, clamped so a button near
     the end of the row does not push it off the screen. */
  function openChooser(tab, onChoose) {
    const btn = elActions.children[idx];
    elMenu.style.left = UI.clamp(96 + (btn ? btn.offsetLeft : 0), 96, 964) + 'px';
    Menu.open({ host: elMenu, tabs: [tab], onChoose: onChoose, onClose: render });
  }

  function openSource() {
    openChooser({ label: 'Play from', rows: sourceRows,
                  note: 'Every copy on every server, each already checked.' },
      (n) => {
        if (n === sel) return;
        choose({ sel: n, audio: null, maxBitrate: null, forceStream: false });
      });
  }

  function openQuality() {
    openChooser({ label: 'Quality', rows: qualityRows,
                  note: 'Anything but Original asks the server to re-encode.' },
      (kbps) => {
        if ((kbps || null) === maxBitrate) return;
        choose({ sel: sel, audio: chosenAudio, maxBitrate: kbps, forceStream: forceStream });
      });
  }

  function openAudio() {
    openChooser({ label: 'Audio', rows: audioRows }, (st) => {
      if (chosenAudio && String(chosenAudio.id) === String(st.id)) return;
      /* A direct play hands the panel the whole file and the panel picks its own
         track, so a choice it cannot make itself means asking the server to mux
         — which on a 4K file the guard refuses, and rightly. */
      choose({ sel: sel, audio: st, maxBitrate: maxBitrate, forceStream: needsMux(st) });
    });
  }

  /* Subtitles never reach the guard: they are fetched as text and drawn over the
     video by js/subs.js, so they cost the server one GET and change nothing
     about the stream. An image track is the exception — the only way to show one
     is to have it burnt in, which is a transcode. */
  function openSubs() {
    openChooser({ label: 'Subtitles', rows: subRows,
                  note: 'Drawn over the video as text, so they cost the server nothing.' },
      (st) => {
        if (st && !Media.isTextSub(st)) {
          UI.toast('Kept as it was — an image track would have to be burnt in');
          return;
        }
        chosenSub = st;
        render();
      });
  }

  /* ---------- the extras strip ---------- */

  /* A trailer is a card, not a line: a still with a play glyph and its length,
     the verdict under it because a clip is guarded like anything else. */
  function extraCard(src, on) {
    const v = src.verdict;
    const state = v ? (v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn')) : '';
    const clip = src.copy.item;
    const mins = clip.duration
      ? Math.max(1, Math.round(clip.duration / 60000)) + ' min' : '';
    const shot = Plex.photoUrl(src.server, clip.thumb, 320, 180);
    return `<div class="dt-extra${on ? ' on' : ''}">` +
           '<div class="dt-extra-shot"' +
           (shot ? ` style="background-image: url('${shot}')"` : '') + '>' +
           PLAY_GLYPH +
           (mins ? `<div class="dt-extra-len">${UI.escapeHtml(mins)}</div>` : '') +
           '</div>' +
           '<div class="dt-extra-title">' + UI.escapeHtml(src.title) + '</div>' +
           '<div class="dt-extra-verdict badge ' + state + '">' +
           UI.escapeHtml(Guard.label(v)) + '</div>' +
           '</div>';
  }

  function render() {
    adoptDefault();
    renderActions();

    let html = '';
    for (let i = 0; i < extras.length; i++) {
      html += extraCard(extras[i], strip === 1 && i === idx);
    }
    elExtras.innerHTML = html;
    elExtrasLabel.classList.toggle('hidden', extras.length === 0);
    /* Stepping into the extras lifts them clear of the bottom edge; the
       stylesheet owns what else moves out of their way. */
    elView.classList.toggle('down', strip === 1);
    /* The quality chip names the copy that would play, so it follows the
       Source button. */
    elChips.innerHTML = chipsHtml();
  }

  /* ---------- the rest of the page ---------- */

  /* Everything the rail already knows, so the page is never blank while the
     metadata requests are in flight. */
  function paintSkeleton() {
    headMd = null;
    elTitle.textContent = item.title || '';
    elTagline.textContent = '';
    elSummary.textContent = description(null);
    elNames.textContent = namesLine(null);
    elCrew.innerHTML = '';
    elCast.innerHTML = '';
    renderHead();

    const art = Plex.artUrl(item, 960, 540);
    elArt.style.backgroundImage = art ? `url("${art}")` : 'none';
  }

  /* The kicker, the chips and the ratings, from whatever we have so far. Called
     again as metadata lands and as the selection moves. */
  function renderHead() {
    elKicker.textContent = kickerLine();
    elChips.innerHTML = chipsHtml();
    elRatings.innerHTML = ratingsHtml();
  }

  /* The header says what the rail's header said, which means TMDB's overview
     when the rail already fetched one and Plex's summary otherwise — the two
     screens must not describe the same film differently. */
  function description(md) {
    const got = Art.factsFor(item);
    if (got && got.overview) return got.overview;
    return (md && md.summary) || item.summary || '';
  }

  /* Key actors, names only. Same source as the header above, so the strip of
     photographs further down never contradicts it. */
  function namesLine(md) {
    const got = Art.factsFor(item);
    const names = (got && got.cast.length) ? got.cast
      : (md && md.Role ? md.Role.slice(0, 4).map((r) => { return r.tag; }) : []);
    return names.join('  ·  ');
  }

  /* "MOVIE · SCIENCE FICTION · DENIS VILLENEUVE" — what it is, in amber caps.
     An episode is named by its show; anything we do not have drops out with its
     separator rather than leaving a gap. */
  function kickerLine() {
    const bits = [item.type === 'episode' ? item.grandparentTitle : item.type];
    if (headMd && headMd.Genre && headMd.Genre.length) bits.push(headMd.Genre[0].tag);
    if (headMd && headMd.Director && headMd.Director.length) bits.push(headMd.Director[0].tag);
    return bits.filter(Boolean).join(' · ');
  }

  /* Media.episodeLabel leads with the show, which the kicker already says. */
  function episodeChip() {
    const label = Media.episodeLabel(item);
    const at = label.lastIndexOf('·');
    return at < 0 ? '' : label.slice(at + 1).trim();
  }

  /* TMDB's run time when we have it — it is the film's, where the item's
     duration is this copy's file. */
  function runtimeChip() {
    const got = Art.factsFor(item);
    const mins = (got && got.runtime) ||
               (item.duration ? Math.round(item.duration / 60000) : 0);
    if (!mins) return '';
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  /* The quality of the copy that would play if Play were pressed now. HDR only
     when the server says so — a claim we cannot check is worse than silence. */
  function qualityChip() {
    const src = sources[sel];
    const media = (src && src.media) || null;
    const res = String((media && media.videoResolution) || '').toLowerCase();
    if (!res) return '';
    const name = res === '4k' ? '4K' : (/^\d+$/.test(res) ? res + 'p' : res.toUpperCase());
    return /hdr|dovi|dolby/i.test(media.videoDynamicRange || '') ? name + ' HDR' : name;
  }

  /* Certificate, where it sits in a show, year, run time and quality. A chip we
     have nothing for is absent, never an empty outline. */
  function chipsHtml() {
    const out = [];
    function add(text, outlined) {
      if (!text) return;
      out.push(`<span class="dt-chip${outlined ? ' out' : ''}">` +
               UI.escapeHtml(String(text)) + '</span>');
    }
    add(item.contentRating, true);
    add(episodeChip(), true);
    add(item.year, false);
    add(runtimeChip(), false);
    add(qualityChip(), true);
    return out.join('');
  }

  /* Up to three scores, each labelled with the source it actually came from.
     There is no IMDb here: Plex gives critics and audience, TMDB gives its
     own, and a number under the wrong badge is a lie the user cannot check. */
  function ratingsHtml() {
    const got = Art.factsFor(item);
    const out = [];
    function add(text) {
      out.push(`<span class="dt-rating">${STAR_GLYPH}` +
               '<span class="dt-rating-text">' + UI.escapeHtml(text) + '</span></span>');
    }
    if (headMd && headMd.rating) add(Math.round(headMd.rating * 10) + '% Critics');
    if (headMd && headMd.audienceRating) {
      add(Math.round(headMd.audienceRating * 10) + '% Audience');
    }
    if (got && got.rating) add(got.rating + ' TMDB');
    return out.join('');
  }

  /* Metadata for every copy: each one tells us its versions, and the first to
     arrive also fills in the cast and crew, which are the same whichever server
     you end up playing from. */
  function loadDetails() {
    const gen = generation;
    let filled = false;
    copies.forEach((copy) => {
      Meta.load(copy.item).then((md) => {
        if (gen !== generation || !md) return;
        copy.md = md;
        expand(copy, md);
        if (filled) return;
        filled = true;
        headMd = md;
        renderHead();
        elTagline.textContent = md.tagline || '';
        elSummary.textContent = description(md);
        elNames.textContent = namesLine(md);
        elCrew.innerHTML = crewHtml(md);
        elCast.innerHTML = castHtml(md);
        addExtras(md);
        addOtherVersions(md);
      });
    });
  }

  function crewHtml(md) {
    const bits = [];
    function names(list) {
      return (list || []).map((x) => { return UI.escapeHtml(x.tag); }).join(', ');
    }
    if (md.Director && md.Director.length) bits.push(`<b>Director</b> ${names(md.Director)}`);
    if (md.Writer && md.Writer.length) bits.push(`<b>Writer</b> ${names(md.Writer)}`);
    if (md.studio) bits.push(`<b>Studio</b> ${UI.escapeHtml(md.studio)}`);
    return bits.join('<span class="dt-gap"></span>');
  }

  /* The first letters of the first two words: "Ada Lovelace" is AL. */
  function initials(name) {
    const words = String(name || '').trim().split(/\s+/);
    let out = '';
    for (let i = 0; i < words.length && out.length < 2; i++) {
      if (words[i]) out += words[i].charAt(0).toUpperCase();
    }
    return out;
  }

  function castHtml(md) {
    const roles = (md.Role || []).slice(0, 8);
    let html = '';
    let url;
    if (!roles.length) return '';
    for (let i = 0; i < roles.length; i++) {
      const r = roles[i];
      url = Plex.photoUrl(Servers.of(md), r.thumb, 120, 120);
      html += '<div class="dt-actor">' +
              (url ? `<img src="${url}" alt="">`
                   : `<div class="dt-actor-blank">${UI.escapeHtml(initials(r.tag))}</div>`) +
              '<div class="dt-actor-name">' + UI.escapeHtml(r.tag) + '</div>' +
              '<div class="dt-actor-role">' + UI.escapeHtml(r.role || '') + '</div>' +
              '</div>';
    }
    return html;
  }

  /* ---------- keys ---------- */

  /* Hand a verdict to the caller, or say why there is nothing to hand over. A
     refusal is the long form on the message screen: this is the one moment the
     user has asked for the whole story. `at` is seconds to begin at, left out
     to pick up wherever the item says. */
  function start(v, isExtra, at) {
    if (!v) { UI.toast('Still checking that copy…'); return; }
    if (!v.ok) {
      const why = Guard.refusal(item, v);
      UI.message(why[0], why[1]);
      return;
    }
    if (opts.onPlay) {
      opts.onPlay(item, v, isExtra, isExtra ? null : (chosenSub && chosenSub.languageCode), at);
    }
  }

  function key(code) {
    const K = UI.KEY;
    if (Menu.isOpen()) return Menu.key(code);
    const last = (strip === 0 ? actions().length : extras.length) - 1;

    if (code === K.LEFT && idx > 0) { idx--; render(); return true; }
    if (code === K.RIGHT && idx < last) { idx++; render(); return true; }
    if (code === K.DOWN && strip === 0 && extras.length) {
      strip = 1; idx = 0; render(); return true;
    }
    if (code === K.UP && strip === 1) { strip = 0; idx = 0; render(); return true; }
    if (code === K.OK) {
      const a = strip === 0 ? actions()[idx] : null;
      if (a) a.run(); else start(extras[idx] && extras[idx].verdict, true);
      return true;
    }
    if (UI.isBack(code)) { close(); return true; }
    return true;                      // this page swallows everything else
  }

  /* The film currently open, so the message screen knows to come back here
     rather than dropping to the rail. */
  function current() { return item; }

  return { open: open, key: key, current: current };
})();
/* A show: its series across the top, its episodes down the side.

   The episode list is where playback actually starts, so each row carries the
   same verdict the detail page would give it — checked for the focused episode
   as you move, against the preferred server's copy. OK plays when that copy
   will direct play, and opens the copy chooser when it will not, which is the
   only time you need to care which server an episode came from. */
var ShowPage = (function () {
  'use strict';

  const elTitle = document.getElementById('sh-title');
  const elMeta = document.getElementById('sh-meta');
  const elSummary = document.getElementById('sh-summary');
  const elSeasons = document.getElementById('sh-seasons');
  const elEpisodes = document.getElementById('sh-episodes');
  const elArt = document.getElementById('sh-art');
  const elHint = document.getElementById('sh-hint');
  const elRecaps = document.getElementById('sh-recaps');
  const elHead = document.getElementById('sh-head');
  const elTheme = document.getElementById('theme');

  const EPISODE_POOL = 6;          // episode rows on screen at once, at 111px each
  const EPISODE_LEAD = 3;          // rows kept above the focused one
  const RECAP_POOL = 7;            // recap cards on screen at once, at 222px each
  const RECAP_LEAD = 2;

  let show = null;
  let seasons = [];
  let seasonIdx = 0;
  let episodes = [];
  let epIdx = 0;
  let zone = 'episodes';         // 'seasons' | 'episodes' | 'recaps'
  let recaps = null;             // null until searched, then the list, empty or not
  let recapIdx = 0;
  let searching = false;
  let wantEp = null;             // options.at.episode, honoured on the first load only
  let opts = {};
  let generation = 0;
  let verdicts = {};             // ratingKey -> verdict, for the rows
  let checkTimer = null;

  /* options.at = { season, episode } opens on a named episode — Plex's own
     index values, not array positions. Without it the page opens where it
     always did. */
  function open(entry, options) {
    if (!entry) return;
    show = entry;
    opts = options || {};
    wantEp = (opts.at && opts.at.episode !== undefined) ? opts.at.episode : null;
    generation++;
    seasons = []; episodes = []; seasonIdx = 0; epIdx = 0; zone = 'episodes';
    verdicts = {};
    recaps = null; recapIdx = 0; searching = false;

    UI.show('show');
    paintHeader();
    silence();                   // whatever the last series was, it is over
    playTheme();
    renderRecaps();
    elSeasons.innerHTML = '';
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';

    const gen = generation;
    Shows.seasons(entry).then((list) => {
      if (gen !== generation) return;
      seasons = list;
      seasonIdx = openSeason(list);
      renderSeasons();
      if (!list.length) {
        elEpisodes.innerHTML = '<div class="sh-episode">This server lists no series for ' +
                               'this show.</div>';
        return;
      }
      loadEpisodes();
    }).catch((e) => {
      if (gen !== generation) return;
      UI.debug(`seasons: ${e.message}`);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the series list.</div>';
    });
  }

  function openSeason(list) {
    const want = opts.at && opts.at.season;
    if (want !== undefined && want !== null) {
      for (let i = 0; i < list.length; i++) if (list[i].index === want) return i;
    }
    return Shows.openAt(list);
  }

  function close() {
    clearTimeout(checkTimer);
    silence();
    show = null;
    if (opts.onExit) opts.onExit();
  }

  /* ---------- painting ---------- */

  function paintHeader() {
    elTitle.textContent = show.title || '';
    elSummary.textContent = show.summary || '';
    const bits = [];
    if (show.year) bits.push(show.year);
    const counts = Shows.summary(show);
    if (counts) bits.push(counts);
    if (show.contentRating) bits.push(show.contentRating);
    if (Merge.isShared(show)) bits.push(`on ${Merge.sources(show).length} servers`);
    elMeta.textContent = bits.join('   ·   ');
    const art = Plex.artUrl(show, 960, 540);
    elArt.style.backgroundImage = art ? `url("${art}")` : 'none';
  }

  function renderSeasons() {
    let html = '';
    for (let i = 0; i < seasons.length; i++) {
      const cls = `chip${i === seasonIdx ? ' cur' : ''}` +
            (zone === 'seasons' && i === seasonIdx ? ' on' : '');
      html += `<span class="${cls}">${UI.escapeHtml(seasons[i].title || ('Series ' + (i + 1)))}` +
              '</span>';
    }
    elSeasons.innerHTML = html;
  }

  function verdictHtml(ep) {
    const v = verdicts[verdictKey(ep)];
    if (!v) return '';
    const state = v.ok ? 'good' : (v.state === 'noaudio' ? 'bad' : 'warn');
    return `<span class="badge ${state} sh-verdict">` +
           UI.escapeHtml(Guard.label(v)) + '</span>';
  }

  function verdictKey(ep) { return ep._server + ':' + ep.ratingKey; }

  function renderEpisodes() {
    if (!episodes.length) {
      elEpisodes.innerHTML = '<div class="sh-episode">No episodes in this series.</div>';
      return;
    }
    /* A window, not the lot: a 24-episode series is common and drawing all of
       them costs more than it is worth. */
    const first = UI.clamp(epIdx - EPISODE_LEAD, 0, Math.max(0, episodes.length - EPISODE_POOL));
    let html = '';
    let on;
    let watched;
    let still;
    for (let i = first; i < Math.min(first + EPISODE_POOL, episodes.length); i++) {
      const ep = episodes[i];
      on = (i === epIdx && zone === 'episodes');
      watched = ep.viewOffset && ep.duration
        ? Math.round(100 * ep.viewOffset / ep.duration) + '%'
        : (ep.viewCount ? 'watched' : '');
      /* An episode's thumb *is* its still, so the picture is already paid for. */
      still = Plex.posterUrl(ep, 160, 90);
      html += `<div class="sh-episode${on ? ' on' : ''}">` +
              '<span class="sh-ep-still"' +
              (still ? ` style="background-image:url(${UI.escapeHtml(still)})"` : '') +
              '></span>' +
              '<span class="sh-ep-num">' + (ep.index === undefined ? '·' : ep.index) + '</span>' +
              '<span class="sh-ep-title">' + UI.escapeHtml(ep.title || '') + '</span>' +
              '<span class="sh-ep-mins">' +
              (ep.duration ? Math.round(ep.duration / 60000) + ' min' : '') + '</span>' +
              '<span class="sh-ep-seen">' + UI.escapeHtml(watched) + '</span>' +
              verdictHtml(ep) +
              '</div>';
    }
    elEpisodes.innerHTML = html;
    elHint.textContent = hint();
  }

  function hint() {
    if (zone === 'seasons') return '← → choose a series · ↓ to the episodes · BACK to the rail';
    if (zone === 'recaps') {
      return recaps && recaps.length
        ? '← → choose a recap · OK to play it · ↑ back to the episodes'
        : 'OK to look for season recaps · ↑ back to the episodes';
    }
    return '↑ ↓ choose an episode · OK to play · → other copies · BACK to the rail';
  }

  /* The recaps strip, which costs nothing to draw: one action until it is
     pressed, then the rail it turned into. Entering the zone lifts the episode
     list to make room — a transform, not a height. */
  function renderRecaps() {
    if (!Youtube.enabled()) { elRecaps.innerHTML = ''; return; }
    const on = zone === 'recaps';
    elHint.textContent = hint();
    elRecaps.classList.toggle('open', on);
    /* The whole column moves, or the episode rows would slide over the title. */
    elHead.classList.toggle('lifted', on);
    elSeasons.classList.toggle('lifted', on);
    elEpisodes.classList.toggle('lifted', on);
    if (!recaps || !recaps.length) {
      elRecaps.innerHTML = `<div class="sh-recap sh-recap-action${on ? ' on' : ''}">` +
        (searching ? 'Searching…' : (recaps ? 'No recaps found' : 'Find recaps')) + '</div>';
      return;
    }
    const first = UI.clamp(recapIdx - RECAP_LEAD, 0, Math.max(0, recaps.length - RECAP_POOL));
    let html = '';
    for (let i = first; i < Math.min(first + RECAP_POOL, recaps.length); i++) {
      const r = recaps[i];
      html += `<div class="sh-recap${on && i === recapIdx ? ' on' : ''}">` +
              '<span class="sh-recap-thumb"' +
              (r.thumb ? ` style="background-image:url(${UI.escapeHtml(r.thumb)})"` : '') +
              '></span>' +
              '<span class="sh-recap-title">' + UI.escapeHtml(r.title) + '</span>' +
              '<span class="sh-recap-len">' + UI.escapeHtml(r.length) + '</span>' +
              '</div>';
    }
    elRecaps.innerHTML = html;
  }

  /* A search is 100 units of the day's 10,000, so it happens on a press and
     never on a page opening — and a show already searched is read back from the
     cache, empty answer included. */
  function findRecaps() {
    if (searching || recaps) return;
    searching = true;
    renderRecaps();
    const gen = generation;
    const title = show.title || '';
    const id = Media.identity(show);
    Cached.recaps.get(id).then((cached) => {
      if (cached) return cached;
      return Youtube.recaps(title).then((items) => {
        const list = Youtube.pickForShow(Youtube.parse(items), title);
        Cached.recaps.put(id, list);
        return list;
      });
    }).then((list) => {
      if (gen !== generation) return;
      searching = false;
      recaps = list;
      recapIdx = 0;
      renderRecaps();
    }, (e) => {
      if (gen !== generation) return;
      UI.debug(`recaps: ${e.message}`);
      /* Nothing was learnt, so the action goes back to being untried rather
         than claiming this show has no recaps. */
      searching = false;
      renderRecaps();
      UI.toast('Could not search for recaps');
    });
  }

  /* ---------- the theme tune ----------

     Shows have one, films do not. It is a static file on the server, so playing
     it costs a GET and nothing else: no decision, no session, nothing a
     kill-stream rule would ever see. */

  const THEME_VOL = 0.35;           // quiet: it announces the show, it is not the show
  const FADE_STEP = 40;             // ms between volume steps while fading in
  let fadeTimer = null;
  let themeOn = null;             // read from storage once, then cached

  /* Whether a series' theme plays when its page opens. Storage that refuses us
     reads as on, because on is what was asked for. */
  function themePlays() {
    if (themeOn !== null) return themeOn;
    let stored = null;
    try { stored = localStorage.getItem('reflex.theme'); } catch (e) { stored = null; }
    themeOn = stored !== 'off';
    return themeOn;
  }

  /* on → off → on, persisted; the sidebar cycles it the way it cycles autoplay. */
  function cycleTheme() {
    themeOn = !themePlays();
    try { localStorage.setItem('reflex.theme', themeOn ? 'on' : 'off'); } catch (e) { /* private mode */ }
    if (!themeOn) silence();
    return themeOn;
  }

  /* 'on' or 'off' — what the sidebar entry and its toast say. */
  function themeLabel() { return themePlays() ? 'on' : 'off'; }

  /* A show with no theme is the ordinary case, so this says nothing about it. */
  function playTheme() {
    const url = themePlays() ? Plex.themeUrl(Servers.of(show), show) : '';
    if (!url) return;
    elTheme.loop = true;
    elTheme.volume = 0;
    elTheme.src = url;
    const started = elTheme.play();
    /* The platform may refuse to start audio nobody asked for. That is an
       answer, not a fault: say so once and stay silent. */
    if (started && started.catch) {
      started.catch((e) => { UI.debug(`theme: ${e.message}`); });
    }
    fadeIn();
  }

  function fadeIn() {
    const span = parseFloat(getComputedStyle(document.documentElement)
                            .getPropertyValue('--t-move')) || 340;
    const step = THEME_VOL / Math.max(1, Math.round(span / FADE_STEP));
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      const v = elTheme.volume + step;
      if (v < THEME_VOL) { elTheme.volume = v; return; }
      elTheme.volume = THEME_VOL;
      clearInterval(fadeTimer);
      fadeTimer = null;
    }, FADE_STEP);
  }

  /* Stops the theme dead — paused, rewound, and the source dropped, because a
     paused element still holding a source is still holding the audio pipeline.
     Anything that wants the audio calls this first. */
  function silence() {
    clearInterval(fadeTimer);
    fadeTimer = null;
    if (!elTheme.getAttribute('src')) return;
    elTheme.pause();
    elTheme.currentTime = 0;
    elTheme.removeAttribute('src');
    elTheme.load();
  }

  /* ---------- loading ---------- */

  function loadEpisodes() {
    const gen = generation;
    const season = seasons[seasonIdx];
    /* The episode we were opened at is for this load only: switching series
       afterwards goes back to landing on the first unfinished one. */
    const want = wantEp;
    wantEp = null;
    episodes = [];
    epIdx = 0;
    elEpisodes.innerHTML = '<div class="sh-episode">Loading…</div>';
    Shows.episodes(season).then((list) => {
      if (gen !== generation) return;
      episodes = list;
      /* Land on the episode we were opened at, or failing that the first
         unfinished one: what you want is almost always the next one. */
      for (let i = 0; i < list.length; i++) {
        const hit = want === null ? (list[i].viewOffset || !list[i].viewCount)
                            : list[i].index === want;
        if (hit) { epIdx = i; break; }
      }
      renderEpisodes();
      scheduleCheck();
    }).catch((e) => {
      if (gen !== generation) return;
      UI.debug(`episodes: ${e.message}`);
      elEpisodes.innerHTML = '<div class="sh-episode">Could not read the episode list.</div>';
    });
  }

  /* The focused episode gets checked, once you have stopped moving. Everything
     the guard does is either cached or a hasMDE=1 query, so this costs the
     server a query per episode you rest on and opens no sessions. */
  function scheduleCheck() {
    clearTimeout(checkTimer);
    const ep = episodes[epIdx];
    if (!ep || verdicts[verdictKey(ep)]) return;
    const gen = generation;
    checkTimer = setTimeout(() => {
      Guard.check(ep, 0).then((v) => {
        if (gen !== generation) return;
        verdicts[verdictKey(ep)] = v;
        renderEpisodes();
      });
    }, 300);
  }

  /* ---------- keys ---------- */

  function playFocused() {
    const ep = episodes[epIdx];
    if (!ep) return;
    const v = verdicts[verdictKey(ep)];
    /* Not checked yet, or the preferred copy will not play: the detail page is
       where every copy is listed, so send them there rather than guessing. */
    if (!v || !v.ok) { openCopies(); return; }
    if (opts.onPlay) opts.onPlay(ep, v);
  }

  function openCopies() {
    const ep = episodes[epIdx];
    if (ep && opts.onChoose) opts.onChoose(ep);
  }

  /* OK in the recaps zone is either the search or one of its results. */
  function chooseRecap() {
    if (!recaps) { findRecaps(); return; }
    const video = recaps[recapIdx];
    if (video && opts.onRecap) opts.onRecap(video);
  }

  function key(code) {
    const K = UI.KEY;

    if (zone === 'seasons') {
      if (code === K.LEFT && seasonIdx > 0) { seasonIdx--; renderSeasons(); loadEpisodes(); return true; }
      if (code === K.RIGHT && seasonIdx < seasons.length - 1) {
        seasonIdx++; renderSeasons(); loadEpisodes(); return true;
      }
      if (code === K.DOWN || code === K.OK) {
        zone = 'episodes'; renderSeasons(); renderEpisodes(); return true;
      }
      if (UI.isBack(code)) { close(); return true; }
      return true;
    }

    if (zone === 'recaps') {
      if (code === K.UP) { zone = 'episodes'; renderEpisodes(); renderRecaps(); return true; }
      if (code === K.LEFT && recapIdx > 0) { recapIdx--; renderRecaps(); return true; }
      if (code === K.RIGHT && recaps && recapIdx < recaps.length - 1) {
        recapIdx++; renderRecaps(); return true;
      }
      if (code === K.OK) { chooseRecap(); return true; }
      if (UI.isBack(code)) { close(); return true; }
      return true;
    }

    if (code === K.UP) {
      if (epIdx > 0) { epIdx--; renderEpisodes(); scheduleCheck(); }
      else { zone = 'seasons'; renderSeasons(); renderEpisodes(); }
      return true;
    }
    if (code === K.DOWN) {
      if (epIdx < episodes.length - 1) { epIdx++; renderEpisodes(); scheduleCheck(); return true; }
      /* Past the last episode is the recaps strip, when there is a key for it. */
      if (Youtube.enabled()) { zone = 'recaps'; renderEpisodes(); renderRecaps(); }
      return true;
    }
    if (code === K.RIGHT) { openCopies(); return true; }
    if (code === K.OK) { playFocused(); return true; }
    if (UI.isBack(code)) { close(); return true; }
    return true;                     // this page swallows everything else
  }

  function current() { return show; }

  return { open: open, key: key, current: current, silence: silence,
           cycleTheme: cycleTheme, themeLabel: themeLabel };
})();
/* Whose viewing is this?

   Plex attributes everything to the account, not the person. On a shared
   account that means someone else's half-watched films sit in Continue
   watching, which makes the row useless. Each history entry does record the
   device that played it, so: ask once which devices are yours, then drop deck
   items last played on one that is not.

   Device ids are per server, so everything here is keyed by server *and* id —
   "device 1" on one server is not "device 1" on the other. A merged entry is
   kept if any of its copies was watched on a device you claim, or on a device
   we have no record of: unknown provenance is kept, because a stray entry beats
   silently hiding your own viewing. */
var Devices = (function () {
  'use strict';

  /* Enough to attribute the Continue watching row, which is all this is for.
     It is fetched per server on the first paint's critical path, and Plex
     history entries are fat. */
  const HISTORY = 100;

  let played = null;             // 'serverId:ratingKey' -> 'serverId:deviceID'
  let claimed = null;            // null = never configured, so don't filter
  let list = [];
  let idx = 0;
  let onClose = null;

  const elList = document.getElementById('device-list');

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* full */ } }

  function init() {
    const raw = lsGet('myDevices');
    if (!raw) return;
    try { claimed = JSON.parse(raw); } catch (e) { claimed = null; }
  }

  function itemKey(server, ratingKey) { return server.id + ':' + ratingKey; }

  /* One history fetch per server per session gives us "which device last played
     this". onDeck carries no device information of its own, so this is the only
     way to tell your viewing from the other TV's. */
  function ensureHistory() {
    if (played) return Promise.resolve(played);
    const servers = Servers.all();
    return Promise.all(servers.map((sv) => {
      return Plex.history(sv, HISTORY).then((entries) => {
        return { server: sv, entries: entries };
      });
    })).then((perServer) => {
      const map = {};
      let count = 0;
      perServer.forEach((res) => {
        /* Sorted newest first, so the first entry per item is the latest. */
        res.entries.forEach((e) => {
          if (!e.ratingKey || e.deviceID === undefined) return;
          const k = itemKey(res.server, e.ratingKey);
          if (map[k] === undefined) { map[k] = res.server.id + ':' + e.deviceID; count++; }
        });
      });
      played = map;
      UI.debug(`history: ${count} items across ${servers.length} server` +
               (servers.length === 1 ? '' : 's') + ', ' + countDevices(map) + ' devices');
      return map;
    }).catch((e) => {
      UI.debug(`history unavailable: ${e.message}`);
      played = {};                 // don't retry all session; filtering just stays off
      return played;
    });
  }

  function countDevices(map) {
    const seen = {};
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i++) seen[map[keys[i]]] = true;
    return Object.keys(seen).length;
  }

  /* A merged entry survives if any copy of it does. */
  function mine(items) {
    if (!claimed || !played) return items;
    return items.filter((entry) => {
      const copies = Merge.sources(entry);
      for (let i = 0; i < copies.length; i++) {
        const dev = played[(copies[i]._server || '') + ':' + copies[i].ratingKey];
        if (!dev || claimed[dev]) return true;
      }
      return false;
    });
  }

  /* ---------- the claim screen ---------- */

  function open(onSaved) {
    onClose = onSaved;
    UI.show('devices');
    idx = 0;
    elList.innerHTML = '<div class="device-row">Reading history…</div>';
    const servers = Servers.all();
    Promise.all([
      ensureHistory(),
      Promise.all(servers.map((sv) => {
        return Plex.devices(sv).then((d) => { return { server: sv, devices: d }; });
      }))
    ]).then((res) => {
      const map = res[0] || {};
      const named = res[1] || [];
      const names = {};
      const counts = {};
      const keys = Object.keys(map);
      named.forEach((n) => {
        n.devices.forEach((d) => { names[n.server.id + ':' + d.id] = d.name; });
      });
      for (let i = 0; i < keys.length; i++) {
        counts[map[keys[i]]] = (counts[map[keys[i]]] || 0) + 1;
      }
      list = Object.keys(counts).map((k) => {
        const server = Servers.get(k.split(':')[0]);
        return { key: k, name: names[k] || (`device ${k.split(':')[1]}`),
                 server: Servers.label(server), count: counts[k],
                 mine: claimed ? !!claimed[k] : true };
      }).sort((a, b) => { return b.count - a.count; });
      render();
    });
  }

  function render() {
    if (!list.length) {
      elList.innerHTML =
        '<div class="device-row">No device history available on these servers.</div>';
      return;
    }
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      html += `<div class="device-row${i === idx ? ' on' : ''}">` +
              (d.mine ? '[x] ' : '[ ] ') + UI.escapeHtml(d.name) +
              (d.server ? ` <span class="device-count">on ${UI.escapeHtml(d.server)}` +
                          '</span>' : '') +
              ' <span class="device-count">' + d.count + ' items</span></div>';
    }
    elList.innerHTML = html;
  }

  function save() {
    let changed = false;
    if (list.length) {
      const map = {};
      for (let i = 0; i < list.length; i++) if (list[i].mine) map[list[i].key] = true;
      claimed = map;
      lsSet('myDevices', JSON.stringify(map));
      UI.debug(`devices: ${Object.keys(map).length} of ${list.length} claimed`);
      changed = true;
    }
    const done = onClose;
    onClose = null;
    if (done) done(changed);
  }

  /* Returns true if it handled the key. */
  function key(code) {
    if (code === UI.KEY.UP && idx > 0) { idx--; render(); return true; }
    if (code === UI.KEY.DOWN && idx < list.length - 1) { idx++; render(); return true; }
    if (code === UI.KEY.OK && list[idx]) {
      list[idx].mine = !list[idx].mine;
      render();
      return true;
    }
    if (UI.isBack(code)) { save(); return true; }
    return true;                    // this screen swallows everything else
  }

  return { init: init, ensureHistory: ensureHistory, mine: mine, open: open, key: key };
})();
/* The Discovery page: your own categories, drawn from TMDB.

   A tile only needs a title and a picture, and TMDB has both — so a row here
   costs one TMDB request and not a single one against a server we do not own.
   Everything Plex-shaped (a ratingKey, media, a guard verdict) is needed only
   when acting on a title, so it is fetched when you rest on one and not before.

   js/config.js holds the categories, js/tmdb.js fetches them, this turns them
   into rows and answers "do we actually have this?" one title at a time. */
var Discovery = (function () {
  'use strict';

  function enabled() { return Tmdb.enabled(); }

  /* A TMDB result as something the rail can draw with no Plex request at all:
     the synthetic Guid is what js/art.js keys the poster on, and _resolved is
     undefined until someone asks whether we hold it. */
  function entry(result) {
    return { type: 'movie', title: result.title, year: result.year,
             Guid: [{ id: `tmdb://${result.id}` }],
             _tmdb: result,
             _resolved: undefined };
  }

  /* Is this a title drawn from TMDB rather than out of a library? */
  function isEntry(item) { return !!(item && item._tmdb); }

  /* The line the masthead shows under the name — the honest answer before OK
     is pressed. */
  function settle(item, found) {
    const sub = found ? Media.railSub(found) : '';
    item._resolved = found || null;
    item._availability = !found ? 'Not in your library'
      : (sub ? `In your library  ·  ${sub}` : 'In your library');
  }

  function ask(id) {
    return Promise.all(Servers.all().map((sv) => {
      return Plex.findByGuid(sv, `tmdb://${id}`).catch(() => { return null; });
    })).then((perServer) => {
      const hits = [];
      for (let i = 0; i < perServer.length; i++) if (perServer[i]) hits.push(perServer[i]);
      return hits.length ? Merge.lists([hits])[0] : null;
    });
  }

  /* The copy we hold of a TMDB title, or null for one we do not. Call it for
     the focused tile and on OK — never for a tile that is merely drawn, which
     is the whole difference between this page and crawling the library. */
  function resolve(item) {
    if (item._resolved !== undefined) return Promise.resolve(item._resolved);
    if (item._asking) return item._asking;
    item._asking = Cached.lookup.get(item._tmdb.id).then((hit) => {
      if (hit !== undefined) return hit;
      return ask(item._tmdb.id).then((found) => {
        Cached.lookup.put(item._tmdb.id, found);
        return found;
      });
    }).then((found) => {
      settle(item, found);
      return item._resolved;
    }, (e) => {
      item._asking = null;                    // a failed lookup is worth retrying
      UI.debug(`resolve ${item.title}: ${e.message}`);
      return null;
    });
    return item._asking;
  }

  /* One row per category in js/config.js, each one TMDB request cached for the
     day and published the moment it lands. ctx.isCurrent() guards against a
     section switch mid-flight; ctx.seeds are the TMDB ids of what has been
     watched, which the caller already holds — asking a server for them would
     cost the page the very thing it exists to avoid. */
  function load(ctx) {
    const cats = Config.categories || [];
    let i = 0;
    function step() {
      if (!ctx.isCurrent() || i >= cats.length) return Promise.resolve();
      return one(ctx, cats[i++]).then(step);
    }
    return step();
  }

  function one(ctx, cat) {
    const seeds = ctx.seeds || [];
    const key = cat.kind + ':' + (cat.id || seeds.join('-'));
    return Cached.catalogue.get(key).then((hit) => {
      if (hit && hit.length) return hit;
      return Tmdb.catalogue(cat, seeds).then((found) => {
        Cached.catalogue.put(key, found);
        return found;
      });
    }).then((found) => {
      if (!ctx.isCurrent()) return;
      if (!found.length) { UI.debug(cat.title + ': TMDB returned nothing'); return; }
      ctx.add(cat.title, found.map(entry));
      UI.debug(cat.title + ': ' + found.length + ' from TMDB');
    }, (e) => {
      UI.debug(cat.title + ' failed: ' + e.message);
    });
  }

  return { enabled: enabled, load: load, entry: entry, isEntry: isEntry, resolve: resolve };
})();
/* The sections, moved off the top of the screen.

   An overlay inside the browse view rather than a view of its own, so nothing
   in js/app.js or js/ui.js has to know it exists: Browse hands it the key while
   it is open and takes it back when it closes.

   Everything the old chip row reached is here, because the Magic Remote has no
   colour buttons and this is now the only way to any of it. A section's own
   category rows hang under it — the hub titles Browse already holds, so opening
   this fetches nothing. */
var Sidebar = (function () {
  'use strict';

  const el = document.getElementById('sidebar-list');

  const VIEW_H = 968;     // the panel less its top padding and a little breathing room
  let offset = 0;       // how far the list is wound up, in px

  let secs = [];        // { title, categories: [string], current }
  let watching = null;  // { current, type } — the Continue watching entry's state
  let rows = [];        // the flattened list the d-pad walks
  let idx = 0;
  let showing = false;
  const NONE = -2;        // nothing expanded; sections are 0-up and watching is -1
  let expanded = NONE;  // which entry's children are listed, if any
  let onPick = null;
  let atMode = '';      // the mode showing, so it can be marked as the sections are

  /* Kids, discovery and search are modes rather than sections; the last three
     are the settings the chip row used to carry. */
  function modes() {
    const out = [{ label: 'Discovery', kind: 'discover', current: atMode === 'discover' },
               { label: 'Kids', kind: 'kids', current: atMode === 'kids' },
               { label: 'Search', kind: 'search' }];
    if (Servers.count() > 1) {
      const pref = Servers.get(Servers.preferred());
      out.push({ label: `Prefer ${pref ? pref.name : '?'}`, kind: 'prefer' });
    }
    /* An action on Continue watching rather than a mode, but this remote has no
       colour buttons at all, so green is the shortcut and this is the route.
       Absent when the row is empty: there is nothing to clear out of it. */
    if (watching && watching.has) {
      out.push({ label: 'Clear from Continue watching', kind: 'clear' });
    }
    out.push({ label: 'Devices', kind: 'devices' });
    out.push({ label: 'Panel', kind: 'panel' });
    out.push({ label: `Autoplay next: ${Player.autoplayLabel()}`, kind: 'autoplay' });
    out.push({ label: `Theme music: ${ShowPage.themeLabel()}`, kind: 'theme' });
    return out;
  }

  /* Continue watching answers "what was I in the middle of" across films and
     shows at once, so it heads the list rather than hanging under a section,
     with the two cuts of it as its children. */
  function watchingRows() {
    if (!watching) return [];
    const type = watching.type || null;
    const out = [{ label: 'Continue watching', kind: 'watching', index: -1, type: null,
                 opens: true, current: !!watching.current && type === null }];
    if (expanded !== -1) return out;
    out.push({ label: 'Movies', kind: 'watching', index: -1, type: 'movie', sub: true,
               current: !!watching.current && type === 'movie' });
    out.push({ label: 'TV Shows', kind: 'watching', index: -1, type: 'episode', sub: true,
               current: !!watching.current && type === 'episode' });
    return out;
  }

  function build() {
    const out = watchingRows();
    for (let i = 0; i < secs.length; i++) {
      const cats = secs[i].categories || [];
      out.push({ label: secs[i].title, kind: 'section', index: i,
                 opens: cats.length > 0, current: !!secs[i].current });
      if (i !== expanded) continue;
      for (let j = 0; j < cats.length; j++) {
        /* Continue watching has its own entry above, and every section builds
           one — listing them all is the duplication this is rid of. */
        if (cats[j] === 'Continue watching') continue;
        out.push({ label: cats[j], kind: 'row', index: i, row: j, sub: true });
      }
    }
    return out.concat(modes());
  }

  function render() {
    let html = '';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      html += `<div class="sb-row${r.sub ? ' sub' : ''}` +
              (r.current ? ' cur' : '') + (i === idx ? ' on' : '') + '">' +
              UI.escapeHtml(r.label) + '</div>';
    }
    el.innerHTML = html;
    reveal();
  }

  /* Keep the focused row in view by winding the list, the way js/rail.js moves
     a strip: there is no pointer on this set, so overflow:auto would put the
     entries past the fold behind a scrollbar nothing can reach. Rows are two
     different heights, so the offsets are read off the DOM rather than
     arithmetic that would have to know about both. */
  function reveal() {
    const row = el.children[idx];
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (bottom > offset + VIEW_H) offset = bottom - VIEW_H;
    if (top < offset) offset = top;
    if (offset < 0) offset = 0;
    const t = `translateY(${-offset}px)`;
    el.style.transform = t;
    el.style.webkitTransform = t;
  }

  function at(kind, index) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].kind === kind && rows[i].index === index) return i;
    }
    return 0;
  }

  /* sections: what Browse holds — title, the section's row titles, and whether
     it is the one showing. The current section opens expanded, so the thing
     most likely to be wanted is already on screen. mode marks kids or discovery
     the same way, since neither is a section and both can be what you are in.
     watching is { current, type, has }: whether the Continue watching row has
     the focus, which cut of it, and whether it holds anything at all. */
  function open(sections, pick, mode, watchingState) {
    secs = sections || [];
    watching = watchingState || null;
    onPick = pick;
    atMode = mode || '';
    expanded = NONE;
    for (let i = 0; i < secs.length; i++) if (secs[i].current) expanded = i;
    /* The section is current too whenever Continue watching is, so this comes
       second: the list opens on where the focus actually is, not a level up. */
    if (watching && watching.current) expanded = -1;
    rows = build();
    idx = at(expanded === -1 ? 'watching' : 'section', expanded);
    offset = 0;
    showing = true;
    el.parentNode.classList.add('open');
    render();
  }

  function close() {
    showing = false;
    el.parentNode.classList.remove('open');
  }

  function isOpen() { return showing; }

  /* True for every key: an overlay that lets some keys through to the rail
     behind it would move a selection you cannot see. */
  function key(code) {
    const K = UI.KEY;
    const r = rows[idx];

    if (UI.isBack(code) || code === K.LEFT) { close(); return true; }
    if (code === K.UP) { idx = UI.clamp(idx - 1, 0, rows.length - 1); render(); return true; }
    if (code === K.DOWN) { idx = UI.clamp(idx + 1, 0, rows.length - 1); render(); return true; }
    if (code !== K.RIGHT && code !== K.OK) return true;
    if (!r) return true;

    /* An entry with children opens them in place; pressing again on the open
       one — or on a section never visited, whose categories nobody has yet —
       picks it. */
    if (r.opens && r.index !== expanded) {
      expanded = r.index;
      rows = build();
      idx = at(r.kind, r.index);
      render();
      return true;
    }

    close();
    if (onPick) onPick(r);
    return true;
  }

  return { open: open, close: close, isOpen: isOpen, key: key };
})();
/* What is in the rails, and where the focus is.

   Browse owns the state the rest of the app reads: the section list, the rows,
   which row and tile are focused, and which mode is showing (the library, the
   kids cut of it, the curated rows, or a page of search results).

   Every row is built by asking each server separately and merging the answers,
   so a film held by both appears once, carrying both copies. Nothing here
   fetches or holds a whole section: Continue watching and the category rows
   arrive as small preloaded lists, and the All row is virtual over the servers'
   own totals, walking them in title order only as far as you scroll. */
var Browse = (function () {
  'use strict';

  const elBrowse = document.getElementById('browse');
  const elInput = document.getElementById('search-input');
  const elHint = document.getElementById('browse-hint');
  const elConfirm = document.getElementById('confirm');

  let sections = [];
  let secIdx = 0;
  let rows = [];
  let rowIdx = 0;
  const cats = {};                          // section title -> its row titles, for the sidebar
  let deckItems = [];                     // Continue watching, before any type filter
  let watchingType = null;                // the cut applied to it: null, movie or episode
  let wantRow = 0;                        // row to land on once the next section is built
  let mode = 'library';                   // library | kids | discover
  let savedRows = null;                   // rows parked while showing search results
  let searchQuery = null;                 // non-null while the results page is showing
  let generation = 0;                     // bumps on any row change, kills stale paints
  let pageTimer = null;
  let resolveTimer = null;                // a Discovery tile, once you stop on it
  const RESOLVE_HOLD = 420;                 // the stillness the backdrop also waits for
  const MAX_SEEDS = 8;                      // titles the recommended row is built from
  let opts = {};

  let picking = false;                    // green has the deck row in select mode
  let picks = [];                         // the entries picked, while it has
  let pickAt = -1;                        // the row that is happening on

  const RESULTS_PER_ROW = 10;
  const WATCHING = 'Continue watching';
  /* UI.KEY carries red, which search already uses; green is free on this
     screen and is the only other key the Magic Remote's siblings all have. */
  const GREEN = 404;

  /* One section per kind of thing this app can play, whatever the servers call
     their libraries. Music and photos are neither, so they are left out. */
  const SECTION_TITLES = { movie: 'Movies', show: 'TV Shows' };
  const SECTION_ORDER = ['movie', 'show'];

  function init(options) {
    opts = options || {};
    /* Enter from the on-screen keyboard arrives on the input, not the document.
       It must not go on to reach the browse key handler: runSearch switches
       back to the browse view synchronously, so by the time the event bubbled
       up it would read as OK on whatever was focused before the search. */
    elInput.addEventListener('keydown', (e) => {
      if (e.keyCode !== UI.KEY.OK) return;
      e.preventDefault();
      e.stopPropagation();
      runSearch();
    }, false);
  }

  /* ---------- state the rest of the app asks about ---------- */

  function focusedRow() { return rows[rowIdx]; }
  function focusedItem() { const r = focusedRow(); return r ? Rows.itemAt(r, r.focus) : null; }
  function hasRows() { return rows.length > 0; }
  function currentSection() { return sections[secIdx] || null; }

  /* A guard any in-flight load can check before it paints. */
  function generationGuard() {
    const gen = generation;
    return () => { return gen === generation; };
  }

  function render() {
    elBrowse.classList.toggle('results', !!searchQuery);
    /* The hero is full height on the first row and a band everywhere else, so
       the rows have somewhere to go the moment you step into them. */
    elBrowse.classList.toggle('dense', rowIdx !== 0);
    Rail.render(rows, rowIdx);
    Masthead.render(focusedRow(), focusedItem(), rows.length > 0);
    /* The backdrop keeps its own debounce — Meta's skips a cached item and
       would leave the last film's art under the new one's title. */
    Masthead.art(focusedItem());
    scheduleResolve(focusedItem());
    markPicks();
    scheduleWalk();
  }

  /* ---------- servers and sections ----------

     Every movie library on every server is one part of Movies, and every show
     library one part of TV Shows. A server that splits its films across a 4K
     library and an LQ one contributes two parts; the merge folds them back to
     one entry per film, the way it already does across servers. */

  function setSections(perServer) {
    const byType = {};
    let i;
    let type;
    for (i = 0; i < perServer.length; i++) {
      const list = perServer[i].sections || [];
      for (let j = 0; j < list.length; j++) {
        const sec = list[j];
        type = sec.type;
        if (!SECTION_TITLES[type]) continue;
        if (!byType[type]) byType[type] = { title: SECTION_TITLES[type], type: type, parts: [] };
        byType[type].parts.push({ server: perServer[i].server, key: sec.key,
                                  updatedAt: sec.updatedAt || 0 });
      }
    }
    const merged = [];
    for (i = 0; i < SECTION_ORDER.length; i++) {
      if (byType[SECTION_ORDER[i]]) merged.push(byType[SECTION_ORDER[i]]);
    }
    const currentTitle = sections[secIdx] && sections[secIdx].title;
    sections = merged;
    let at = 0;
    for (i = 0; i < merged.length; i++) if (merged[i].title === currentTitle) at = i;
    return at;
  }

  function serversOf(sec) {
    const out = [];
    const seen = {};
    for (let i = 0; i < sec.parts.length; i++) {
      const id = sec.parts[i].server.id;
      if (seen[id]) continue;
      seen[id] = true;
      out.push(sec.parts[i].server);
    }
    return out;
  }

  /* ---------- the sidebar ----------

     The Magic Remote has no colour buttons, so every action has to be reachable
     with the d-pad. Left from the first tile of a row lands here. */

  function openSidebar() {
    /* Continue watching is per account rather than per section, so it heads the
       list on its own rather than once under every section. */
    const at = watchingRowIdx();
    const watching = { current: mode === 'library' && rowIdx === at,
                     type: watchingType,
                     has: at >= 0 && rows[at].total > 0 };
    Sidebar.open(sections.map((sec, i) => {
      /* Category titles are the row titles of a section we have already built,
         so this fetches nothing. A section never visited simply lists none. */
      return { title: sec.title, categories: cats[sec.title] || [],
               current: mode === 'library' && i === secIdx };
    }), activate, mode, watching);
  }

  /* Select mode renames the row, so while it is on the row is known by where it
     is rather than by what it says. */
  function watchingRowIdx() {
    if (picking) return pickAt;
    for (let i = 0; i < rows.length; i++) if (rows[i].title === WATCHING) return i;
    return -1;
  }

  function deckCut() {
    if (!watchingType) return deckItems;
    return deckItems.filter((m) => { return m.type === watchingType; });
  }

  /* Continue watching, cut to films or episodes. The unfiltered deck is kept so
     the cut can be lifted without asking the servers again, and an empty cut
     leaves the row where it is — a row vanishing on a keypress reads as a
     crash. */
  function showWatching(type) {
    const at = watchingRowIdx();
    if (at < 0) { UI.toast('Nothing part-watched there'); return; }
    watchingType = type || null;
    const items = deckCut();
    rows[at] = Rows.list(WATCHING, items);
    rowIdx = at;
    render();
    if (!items.length) UI.toast('Nothing part-watched there');
  }

  /* ---------- clearing Continue watching ----------

     The row grows and never shrinks, and Plex's own way out is marking things
     watched — which for a series two seasons in means losing the fact that you
     have seen two. So an item is hidden where the server can, and only where it
     cannot is the user asked to mark it watched instead. Nothing goes without a
     confirmation, and nothing leaves the row before the server has agreed. */

  function pickIndex(item) {
    const key = Media.identity(item);
    for (let i = 0; i < picks.length; i++) if (Media.identity(picks[i]) === key) return i;
    return -1;
  }

  /* Amber on tiles the rail has already drawn. The row model knows nothing
     about a mode that lasts seconds, and Rail owns no state to teach. */
  function markPicks() {
    const tiles = document.querySelectorAll('#rows .tile');
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      tile.classList.toggle('picked',
        !!(picking && tile._item && pickIndex(tile._item) >= 0));
    }
  }

  function paintPicking() {
    const row = rows[pickAt];
    /* A new row object rather than a renamed one: the rail repaints a label
       only when the row it is handed changes identity. */
    rows[pickAt] = Rows.list(picking ? `Select to remove — ${picks.length} picked`
                                     : WATCHING, row.items);
    rows[pickAt].focus = row.focus;
    elHint.textContent = '◀ ▶ move  ·  OK picks one  ·  green removes what is picked  ·  ' +
                         'BACK leaves it all as it was';
    elHint.classList.toggle('hidden', !picking);
    render();
  }

  function startPicking() {
    const at = watchingRowIdx();
    if (at < 0 || at !== rowIdx) { UI.toast('Green clears things out of Continue watching'); return; }
    if (!rows[at].total) { UI.toast('Nothing part-watched to remove'); return; }
    picking = true;
    pickAt = at;
    picks = [];
    paintPicking();
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    picks = [];
    paintPicking();
  }

  function togglePick() {
    const item = focusedItem();
    let at;
    if (!item) return;
    at = pickIndex(item);
    if (at >= 0) picks.splice(at, 1); else picks.push(item);
    paintPicking();
  }

  /* The confirmation, in the shared menu shell — a title saying what will
     happen and to how many, the action, and Cancel. Cancel is what it lands on:
     the action is one key away and never the default. */
  function askThen(count, mode, go) {
    const hide = mode === 'hide';
    Menu.open({
      host: elConfirm,
      tabs: [{
        label: hide ? `Remove ${count} from Continue watching`
                    : `Mark ${count} watched`,
        note: hide ? 'They stay part-watched.'
                   : 'This server cannot hide them. Marking a show watched marks ' +
                     'every episode.',
        rows: () => {
          return [{ label: hide ? 'Remove them' : 'Mark them watched', value: 'go' },
                  { label: 'Cancel', on: true, value: null }];
        }
      }],
      onChoose: (value) => { if (value === 'go') go(); },
      onClose: render
    });
  }

  /* Marking an episode watched only advances the deck to the next episode, so
     the series stays in the row. Its show is what removes it — and marks every
     episode of it, which is why this path is confirmed in exactly those
     words. */
  function watchedKey(copy) {
    if (copy.type === 'episode' && copy.grandparentRatingKey) return copy.grandparentRatingKey;
    return copy.ratingKey;
  }

  /* Out of the row and out of the cache, so a reload does not bring it back.
     ponytail: the whole section's cached rows go rather than the one row —
     Continue watching is per account and so sits in every section's entry, and
     they are refetched on the next visit anyway. */
  function dropFromDeck(entry) {
    const gone = Media.identity(entry);
    let at;
    let row;
    deckItems = deckItems.filter((m) => { return Media.identity(m) !== gone; });
    for (let i = 0; i < sections.length; i++) Cached.rows.drop(sections[i].title);
    at = watchingRowIdx();
    if (at < 0) return;
    row = Rows.list(rows[at].title, deckCut());
    row.focus = UI.clamp(rows[at].focus, 0, Math.max(0, row.total - 1));
    rows[at] = row;
  }

  /* A job is an entry and the copies of it still to be dealt with — a film on
     both servers is still in the row if only one of them is told, and a copy
     that has already been hidden must not then be marked watched as well. */
  function jobFor(entry) { return { entry: entry, copies: Merge.sources(entry) }; }

  /* The entry leaves the row only once every copy of it has gone; whatever a
     server would not hide comes back as `copies` for the caller to ask about. */
  function clearFromDeck(job, mode) {
    return Promise.all(job.copies.map((copy) => {
      const server = Servers.of(copy);
      if (mode !== 'watched') return Plex.hideFromDeck(server, copy.ratingKey);
      return Plex.scrobble(server, watchedKey(copy)).then(() => { return true; });
    })).then((done) => {
      const refused = [];
      for (let i = 0; i < done.length; i++) if (!done[i]) refused.push(job.copies[i]);
      if (refused.length) return { needsWatched: true, copies: refused };
      dropFromDeck(job.entry);
      return { ok: true };
    }, (e) => {
      UI.debug(`clear: ${e.message}`);
      return { ok: false };
    });
  }

  /* Clear a list of jobs, asking again about only the copies the server would
     not hide. A server that refuses both leaves its item in the row and says
     so. */
  function clearAll(jobs, mode, after) {
    Promise.all(jobs.map((job) => {
      return clearFromDeck(job, mode);
    })).then((res) => {
      const again = [];
      let failed = 0;
      for (let i = 0; i < res.length; i++) {
        if (res[i].ok) continue;
        if (res[i].needsWatched) again.push({ entry: jobs[i].entry, copies: res[i].copies });
        else failed++;
      }
      if (picking) {
        picks = again.map((job) => { return job.entry; });
        paintPicking();
      } else render();
      if (failed) {
        UI.toast(failed + (failed === 1 ? ' was' : ' were') + ' refused — still in the row');
      }
      if (again.length) {
        askThen(again.length, 'watched', () => { clearAll(again, 'watched', after); });
        return;
      }
      stopPicking();
      if (after) after();
    });
  }

  /* Green a second time: confirm everything picked. */
  function confirmPicks() {
    const chosen = picks.map(jobFor);
    if (!chosen.length) { UI.toast('Nothing picked — OK picks the tile you are on'); return; }
    askThen(chosen.length, 'hide', () => { clearAll(chosen, 'hide', null); });
  }

  /* The same action for one title, from its own page. */
  function clearOne(entry, after) {
    askThen(1, 'hide', () => { clearAll([jobFor(entry)], 'hide', after); });
  }

  /* Is this on Continue watching? The detail page only offers to clear
     something the row actually holds. */
  function isOnDeck(item) {
    const key = item && Media.identity(item);
    if (!key) return false;
    for (let i = 0; i < deckItems.length; i++) {
      if (Media.identity(deckItems[i]) === key) return true;
    }
    return false;
  }

  function activate(choice) {
    if (choice.kind === 'search') { openSearch(); return; }
    if (choice.kind === 'watching') {
      /* Kids and discovery have no Continue watching row, so the library comes
         back first — it lands on row 0, which is it. */
      if (mode !== 'library') loadSection(secIdx, true);
      else showWatching(choice.type);
      return;
    }
    if (choice.kind === 'clear') {
      /* The focus can be anywhere when this is chosen, so land on the row
         first: a mode you then have to go and find is not reachable, which is
         the whole reason this entry exists beside the green key. */
      const deckAt = watchingRowIdx();
      if (deckAt < 0) { UI.toast('Nothing part-watched to remove'); return; }
      rowIdx = deckAt;
      startPicking();
      return;
    }
    if (choice.kind === 'kids') { loadKids(); return; }
    if (choice.kind === 'discover') { loadDiscover(); return; }
    if (choice.kind === 'prefer') {
      const now = Servers.get(Servers.cyclePreferred());
      UI.debug(`preferring ${now ? now.name : '?'} where both servers have a film`);
      /* Rebuild the rows: which copy of a shared film is shown changes with
         the preference. */
      loadSection(secIdx, true);
      return;
    }
    if (choice.kind === 'autoplay') {
      Player.cycleAutoplay();
      UI.toast(`Autoplay next: ${Player.autoplayLabel()}`);
      render();
      return;
    }
    if (choice.kind === 'theme') {
      ShowPage.cycleTheme();
      UI.toast(`Theme music: ${ShowPage.themeLabel()}`);
      render();
      return;
    }
    if (choice.kind === 'panel') {
      UI.message('What this panel claims it can play', Panel.report());
      return;
    }
    if (choice.kind === 'devices') {
      Devices.open((changed) => {
        UI.show('browse');
        if (changed) loadSection(secIdx, true); else render();
      });
      return;
    }
    if (choice.kind === 'row') {
      if (mode === 'library' && choice.index === secIdx) {
        rowIdx = UI.clamp(choice.row, 0, rows.length - 1);
        render();
      } else {
        loadSection(choice.index, true, choice.row);
      }
      return;
    }
    mode = 'library';
    if (choice.index !== secIdx) loadSection(choice.index, true);
    else render();
  }

  /* Row titles are what the sidebar lists under a section, and their positions
     are what picking one jumps to, so the two must be the same list. */
  function noteCategories(sec) {
    cats[sec.title] = rows.map((r) => { return r.title; });
  }

  /* ---------- building rows ---------- */

  function reset(newMode) {
    generation++;
    mode = newMode;
    rows = [];
    rowIdx = 0;
    watchingType = null;
    /* The rows the mode was over are gone, so it goes with them rather than
       counting picks nobody can see. */
    picking = false;
    picks = [];
    elHint.classList.add('hidden');
    render();
  }

  /* Rows from titled item lists, remembering the part-watched ones so the
     Continue watching cut has something to filter. */
  function listRows(built) {
    deckItems = [];
    for (let i = 0; i < built.length; i++) {
      if (built[i].title === WATCHING) deckItems = built[i].items;
    }
    return built.map((r) => { return Rows.list(r.title, r.items); });
  }

  /* One page of one server's section, for the merge walk. */
  function pageFetcher() {
    return (part, offset) => {
      return Plex.items(part.server, part.key, offset, Rows.PAGE, part.filter)
        .then((res) => { return { items: res.items, total: res.total }; });
    };
  }

  function allRow(sec, title, filter, tag) {
    /* type 2 asks a show section for shows rather than every episode in it. */
    const base = { type: sec.type === 'show' ? 2 : 1 };
    if (filter) {
      const keys = Object.keys(filter);
      for (let i = 0; i < keys.length; i++) base[keys[i]] = filter[keys[i]];
    }
    const parts = sec.parts.map((p) => {
      return { server: p.server, key: p.key, updatedAt: p.updatedAt,
               filter: base, tag: tag || '' };
    });
    return Rows.merged(title || (sec.type === 'show' ? 'All shows' : 'All films'),
                       parts, pageFetcher());
  }

  /* A section's length, cheaply: size=0 returns totalSize and no items, once
     per server. The merged length is the sum less whatever duplicates the walk
     has found so far, so it only gets more accurate. */
  function primeTotals(row, isCurrent) {
    if (!row || row.kind !== 'merge') return;
    const jobs = row.state.streams.map((s) => {
      if (s.total) return Promise.resolve();
      const ck = s.part.server.id + ':' + s.part.key + ':' + s.part.tag;
      return Cached.total.get(ck).then((cached) => {
        if (cached && cached.total && cached.updatedAt === s.part.updatedAt) {
          s.total = cached.total;
          return;
        }
        return Plex.items(s.part.server, s.part.key, 0, 0, s.part.filter).then((res) => {
          s.total = res.total;
          Cached.total.put(ck, { updatedAt: s.part.updatedAt, total: res.total });
        });
      }).catch((e) => { UI.debug(`count: ${e.message}`); });
    });
    Promise.all(jobs).then(() => {
      if (!isCurrent()) return;
      row.total = Merge.estimate(row.state);
      render();
      UI.debug(row.title + ': about ' + row.total + ' across ' +
               row.state.streams.length + ' server' +
               (row.state.streams.length === 1 ? '' : 's'));
    });
  }

  /* focusRow lands on a named category once its section is built, which is what
     picking one out of the sidebar has to do when it belongs to another
     section. */
  function loadSection(i, allowFetch, focusRow) {
    secIdx = i;
    wantRow = focusRow || 0;
    reset('library');
    const isCurrent = generationGuard();
    const sec = sections[i];
    Cached.rows.get(sec.title).then((cached) => {
      if (!isCurrent()) return;
      if (cached && cached.rows && cached.rows.length) {
        rows = listRows(cached.rows);
        rows.push(allRow(sec));
        noteCategories(sec);
        rowIdx = UI.clamp(wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': rows from cache');
      }
      if (!allowFetch) return;

      /* Continue watching is per server; the category rows are per section. Two
         requests per server for the whole browse screen, however big the
         library is. */
      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map((sv) => { return Plex.onDeck(sv); })),
        Promise.all(sec.parts.map((p) => { return Plex.hubs(p.server, p.key); })),
        Devices.ensureHistory()
      ]).then((res) => {
        if (!isCurrent()) return;
        const built = [];

        /* onDeck is per server, not per section, and hands back films and
           episodes together — which is what you want to carry on with, so it is
           kept whole rather than cut to the section's own type. Most recently
           watched first. */
        const deck = Devices.mine(Merge.lists(res[0]));
        deck.sort((a, b) => { return (b.lastViewedAt || 0) - (a.lastViewedAt || 0); });
        if (deck.length) built.push({ title: WATCHING, items: deck });

        mergeHubs(res[1]).forEach((hub) => { built.push(hub); });

        Cached.rows.put(sec.title, { rows: built });
        rows = listRows(built);
        rows.push(allRow(sec));
        noteCategories(sec);
        rowIdx = UI.clamp(rowIdx || wantRow, 0, rows.length - 1);
        primeTotals(rows[rows.length - 1], isCurrent);
        render();
        UI.debug(sec.title + ': ' + rows.length + ' rows from ' + servers.length + ' server' +
                 (servers.length === 1 ? '' : 's'));
      });
    }).catch((e) => {
      if (!isCurrent()) return;
      UI.debug(`rows: ${e.message}`);
      if (!rows.length) UI.toast('Could not reach the servers');
    });
  }

  /* Both servers offer a "Recently Added"; they are one row, deduplicated.
     Order within it is first-seen, which keeps each server's own ordering
     intact rather than inventing a ranking across them. */
  function mergeHubs(perPart) {
    const byTitle = {};
    const order = [];
    for (let i = 0; i < perPart.length; i++) {
      const list = perPart[i] || [];
      for (let j = 0; j < list.length; j++) {
        if (!byTitle[list[j].title]) { byTitle[list[j].title] = []; order.push(list[j].title); }
        byTitle[list[j].title].push(list[j].items);
      }
    }
    return order.map((title) => {
      return { title: title, items: Merge.lists(byTitle[title]) };
    }).filter((hub) => { return hub.items.length > 0; });
  }

  /* ---------- walking the merge ---------- */

  /* Debounced: scrolling through twenty screens must not fire twenty walks,
     only one for wherever you come to rest. */
  function scheduleWalk() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(() => {
      const row = focusedRow();
      if (!row || row.kind !== 'merge') return;
      if (Rows.haveUpTo(row) > Rows.needsUpTo(row)) return;
      const isCurrent = generationGuard();
      const had = Rows.haveUpTo(row);
      const was = row.total;
      Merge.advance(row.state, Rows.needsUpTo(row)).then(() => {
        if (!isCurrent()) return;
        row.total = Merge.estimate(row.state);
        /* Only repaint if the walk actually produced something, or this would
           schedule itself for ever once the servers are exhausted. */
        if (Rows.haveUpTo(row) === had && row.total === was) return;
        Rail.invalidateEmpty();
        render();
      }).catch((e) => {
        if (!isCurrent()) return;
        UI.debug(`walk: ${e.message}`);
      });
    }, 150);
  }

  /* ---------- kids ---------- */

  function loadKids() {
    const sec = sections[secIdx];
    reset('kids');
    const isCurrent = generationGuard();

    /* Ask each library which certificates it uses, keep the ones at or below
       the cutoff, and let the servers do the filtering. */
    Promise.all(sec.parts.map((p) => {
      return Plex.contentRatings(p.server, p.key);
    })).then((perPart) => {
      if (!isCurrent()) return;
      const kid = [];
      const seen = {};
      perPart.forEach((list) => {
        list.filter(Media.isKidsRating).forEach((r) => {
          if (!seen[r]) { seen[r] = true; kid.push(r); }
        });
      });
      UI.debug(`kids certificates: ${kid.join(', ') || 'none'}`);

      const servers = serversOf(sec);
      return Promise.all([
        Promise.all(servers.map((sv) => { return Plex.onDeck(sv); })),
        Devices.ensureHistory()
      ]).then((res) => {
        if (!isCurrent()) return;
        const kidsWant = sec.type === 'show' ? 'episode' : 'movie';
        const watching = Devices.mine(Merge.lists(res[0])).filter((m) => {
          return m.type === kidsWant && Media.isKidsRating(m.contentRating);
        });
        rows = [];
        if (watching.length) rows.push(Rows.list('Kids · carry on watching', watching));

        if (kid.length) {
          const row = allRow(sec, 'Kids · all films',
                           { contentRating: kid.join(',') }, `kids${Media.KIDS_MAX_AGE}`);
          rows.push(row);
          render();
          primeTotals(row, isCurrent);
          return;
        }
        render();
        if (!watching.length) {
          UI.message('No age ratings', sec.title + ' has no certificate data, so ' +
            'there is nothing to filter on. BACK to return.');
        }
      });
    }).catch((e) => {
      if (!isCurrent()) return;
      UI.debug(`kids: ${e.message}`);
      UI.toast('Could not load the kids list');
    });
  }

  /* ---------- discovery ---------- */

  /* A Discovery tile is looked up on the servers only once you have stopped on
     it, on the same stillness the backdrop waits for — so sweeping a row costs
     nothing and painting the page costs nothing at all. */
  function scheduleResolve(item) {
    clearTimeout(resolveTimer);
    if (!Discovery.isEntry(item) || item._resolved !== undefined) return;
    const gen = generation;
    resolveTimer = setTimeout(() => {
      Discovery.resolve(item).then(() => {
        if (gen === generation && focusedItem() === item) render();
      });
    }, RESOLVE_HOLD);
  }

  /* Seeds for the recommended row, out of the Continue watching row already in
     memory. Asking a server for them would cost the page its whole point. */
  function deckSeeds() {
    const out = [];
    for (let i = 0; i < deckItems.length && out.length < MAX_SEEDS; i++) {
      const id = Plex.tmdbId(deckItems[i]);
      if (id && out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

  function loadDiscover() {
    reset('discover');
    const isCurrent = generationGuard();

    if (!Discovery.enabled()) {
      mode = 'library';
      UI.message('Discovery needs a TMDB key',
        'Curated rows come from TMDB. Put a free v3 API key in tmdbKey in ' +
        'js/config.js. Everything else works without it.');
      return;
    }

    Discovery.load({
      isCurrent: isCurrent,
      seeds: deckSeeds(),
      /* Rows appear as they arrive rather than all at the end — the first one
         lands while the rest are still being fetched. */
      add: (title, items) => {
        rows.push(Rows.list(title, items));
        render();
      }
    }).then(() => {
      if (!isCurrent() || rows.length) return;
      UI.message('Nothing to show',
        'TMDB returned no titles for any of the categories in js/config.js. ' +
        'Check the debug line for which came back empty.');
    });
  }

  function leaveMode() {
    if (mode === 'library') return false;
    loadSection(secIdx, true);
    return true;
  }

  /* ---------- search ---------- */

  function openSearch() {
    UI.show('search');
    elInput.value = '';
    /* webOS raises its own on-screen keyboard when an input takes focus —
       no need to build a letter grid. */
    setTimeout(() => { elInput.focus(); }, 50);
  }

  function closeSearch() {
    elInput.blur();
    UI.show('browse');
    render();
  }

  /* Results land on their own page, not back on the library rows — laid out as
     a grid of RESULTS_PER_ROW using the same row machinery. Both servers are
     asked, and a film on both appears once. */
  function runSearch() {
    const q = elInput.value.trim();
    if (!q) { closeSearch(); return; }
    elInput.blur();
    UI.show('browse');
    UI.toast('Searching…');
    const isCurrent = generationGuard();
    Promise.all(Servers.all().map((sv) => {
      return Plex.search(sv, q);
    })).then((perServer) => {
      if (!isCurrent()) return;
      const found = Merge.lists(perServer);
      if (!savedRows) savedRows = rows;
      searchQuery = q;
      const noun = countNoun(found);
      /* The results page has no chips to head it any more, so the first row's
         own title carries what was asked, what came back, and the way out. */
      const header = q + '  ·  ' + found.length + ' ' + noun + '  ·  BACK to library';
      rows = [];
      for (let i = 0; i < found.length; i += RESULTS_PER_ROW) {
        rows.push(Rows.list(i === 0 ? header : '', found.slice(i, i + RESULTS_PER_ROW)));
      }
      if (!rows.length) rows = [Rows.list(header, [])];
      rowIdx = 0;
      render();
      UI.debug(`search "${q}": ${found.length} ${noun}`);
    }).catch((e) => {
      UI.message('Search failed', e.message);
    });
  }

  /* "3 films", "1 show", or "7 results" when it is both. Saying "films" over a
     list that is half shows is the kind of small lie that makes a screen feel
     untrustworthy. */
  function countNoun(found) {
    let films = 0;
    let shows = 0;
    for (let i = 0; i < found.length; i++) {
      if (found[i].type === 'show') shows++; else films++;
    }
    if (shows && films) return 'results';
    if (shows) return `show${shows === 1 ? '' : 's'}`;
    return `film${films === 1 ? '' : 's'}`;
  }

  /* Back out of a results list to the rows we parked. */
  function clearResults() {
    if (!savedRows) return false;
    rows = savedRows;
    savedRows = null;
    searchQuery = null;
    rowIdx = 0;
    render();
    return true;
  }

  /* ---------- keys ---------- */

  /* The search view: the system keyboard owns every key, OK included — pressing
     OK picks a letter. Only Back is ours; Enter is handled on the input. */
  function searchKey(code) {
    if (UI.isBack(code)) { closeSearch(); return true; }
    return false;
  }

  function key(code) {
    if (Menu.isOpen()) return Menu.key(code);
    if (Sidebar.isOpen()) return Sidebar.key(code);

    let row = focusedRow();
    const K = UI.KEY;

    switch (code) {
      case K.LEFT:
        /* Left off the front of a row is the way to the sections — there is
           nowhere else for it to go, and the rail has no header any more.
           Not while picking: the way out of the mode is BACK, not wandering. */
        if (row && row.focus > 0) { row.focus--; render(); }
        else if (!picking) openSidebar();
        break;
      case K.RIGHT:
        if (row && row.focus < row.total - 1) { row.focus++; render(); }
        break;
      case K.UP:
        if (!picking && rowIdx > 0) { rowIdx--; render(); }
        break;
      case K.DOWN:
        if (!picking && rowIdx < rows.length - 1) { rowIdx++; render(); }
        break;
      case K.OK:
        if (picking) { togglePick(); break; }
        if (opts.onOpen) opts.onOpen(focusedItem());
        break;
      case K.RED:                                 // red, on remotes that have it
        openSearch();
        break;
      case GREEN:                                 // enter the mode, then confirm it
        if (picking) confirmPicks(); else startPicking();
        break;
      default:
        if (!UI.isBack(code)) return false;
        if (picking) { stopPicking(); break; }
        if (!clearResults() && !leaveMode() && opts.onExit) opts.onExit();
        break;
    }
    return true;
  }

  return {
    init: init, render: render, key: key, searchKey: searchKey,
    setSections: setSections, currentSection: currentSection,
    loadSection: loadSection, focusedItem: focusedItem, hasRows: hasRows,
    clearOne: clearOne, isOnDeck: isOnDeck
  };
})();
/* Playback, and everything you can do while it runs.

   What the panel is handed is decided before we get here — js/guard.js says
   whether a copy may play and at what cost, and nothing reaches this file
   without a verdict. What is left is the part the stock app does badly on this
   set: knowing where you are, getting somewhere else quickly, and changing the
   audio, the subtitles or the quality without going back to the film page.

   Three of those four are a restart. The panel picks its own audio track out of
   a direct-played file and cannot be told otherwise, so honouring a choice
   means asking the server for that track and starting again from where we
   were; the same is true of a quality cap or another version of the film. Each
   one goes back through the guard first, which is why a 4K file will refuse a
   quality cap — asking for a cap is asking for a transcode.

   Subtitles are the exception, and deliberately: they are fetched as text and
   drawn over the video by js/subs.js, so switching one costs a single GET and
   no restart. Burning them in would be a transcode. */
var Player = (function () {
  'use strict';

  const v = document.getElementById('video');
  const osd = document.getElementById('osd');
  const osdTitle = document.getElementById('osd-name');
  const osdTime = document.getElementById('osd-time');
  const osdTotal = document.getElementById('osd-total');
  const osdFill = document.getElementById('osd-fill');
  const osdBuffered = document.getElementById('osd-buffered');
  const osdTicks = document.getElementById('osd-ticks');
  const osdBar = document.getElementById('osd-bar');
  const osdKnob = document.getElementById('osd-knob');
  const osdLeft = document.getElementById('osd-left');
  const osdRight = document.getElementById('osd-right');
  const osdHint = document.getElementById('osd-hint');
  const chapEl = document.getElementById('osd-chapters');
  const chapInner = document.getElementById('osd-chapters-inner');
  const skipEl = document.getElementById('osd-skip');
  const nextEl = document.getElementById('upnext');
  const nextStillEl = document.getElementById('un-still');
  const nextShowEl = document.getElementById('un-show');
  const nextTitleEl = document.getElementById('un-title');
  const nextHintEl = document.getElementById('un-hint');
  const subEl = document.getElementById('subtitle');
  const menuEl = document.getElementById('menu');

  const BAR_W = 1300;                // #osd-bar, in CSS pixels
  const CARD_W = 260;                // .osd-chap plus its margin
  const CARDS_SHOWN = 6;
  const SEEK_SETTLE = 400;           // ms of stillness before a seek is applied
  const NUDGE = 30;                  // left / right, seconds
  const JUMP = 300;                  // rewind / fast forward, seconds

  let item = null;
  let server = null;
  let onExit = null;
  let onError = null;
  let onSwitch = null;
  let onNext = null;
  let onPlayNext = null;
  let currentPart = null;
  let currentAudio = null;
  let currentMedia = null;
  let mediaIndex = 0;
  let maxBitrate = null;
  let transcoding = false;
  let forceStream = false;
  let ticker = null;
  let osdTimer = null;
  let resumeMs = 0;

  /* A stall is the thing you actually see as a blip, and it is over before the
     ten-second sample comes round. Count them instead. */
  let stalls = 0;
  let lowest = 999;
  let startedAt = 0;

  /* Where a run of seek presses is heading. Every currentTime assignment on a
     direct-played file is a real seek — a range request, a decoder flush — so
     holding the key would otherwise fire one per press and fight the network
     the whole way. Accumulate, show where you are going, apply once you stop. */
  let pending = null;
  let seekTimer = null;

  /* Subtitles: the parsed cues, which track they came from, and the language
     the user asked for. The language is what survives a restart — after a
     switch to another version the stream ids are different, but "French" still
     means the same thing. */
  let cues = [];
  let currentSub = null;
  let wantedLang = null;
  let subToken = 0;
  let subNote = '';

  /* The skip prompt. The menu is js/menu.js and keeps its own state. */
  let marker = null;

  /* Focus is a mode, and that is the only reason every key CLAUDE.md documents
     goes on meaning what it says: in 'none' the arrows seek, in 'bar' they
     scrub the trackbar, in 'row' they walk the buttons — and ctl says which
     button. Which panel is open under the row, and where the chapter rail is,
     are separate. */
  let focus = 'none';
  let ctl = -1;
  let openPanel = null;
  let chapSel = 0;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec / 60) % 60;
    const s = sec % 60;
    const mm = (m < 10 ? '0' : '') + m;
    const ss = (s < 10 ? '0' : '') + s;
    return h ? (h + ':' + mm + ':' + ss) : (m + ':' + ss);
  }

  /* A live or badly-muxed stream reports Infinity, and every sum here divides
     by this — so fall back to what the server said the film runs to. */
  function duration() {
    const d = v.duration;
    if (d && isFinite(d)) return d;
    return ((item && item.duration) || 0) / 1000;
  }

  /* Where the picture will be once any pending seek lands — that is what the
     user is aiming at, so that is what the bar and the clock have to show. */
  function target() {
    return pending === null ? (v.currentTime || 0) : pending;
  }

  /* ---------- the OSD ----------

     Two separate things: painting the time, and putting the OSD back on screen
     for another few seconds. Repainting must not reset the hide timer, or the
     OSD would never go away once playback started. */

  function paintOsd() {
    let at = target();
    const dur = duration();
    const left = dur ? Math.max(0, dur - at) : 0;

    osdTime.textContent = fmt(at) +
      (pending !== null ? '   SEEKING' : (v.paused ? '   PAUSED' : ''));
    osdTotal.textContent = fmt(dur) + (dur ? `   ·   ${fmt(left)} left` : '');

    const x = dur ? Math.round(BAR_W * Math.min(at, dur) / dur) : 0;
    osdFill.style.width = x + 'px';
    /* transform, not left: the knob moves on every timeupdate and this is the
       one property the panel can move without a layout pass. */
    osdKnob.style.webkitTransform = osdKnob.style.transform =
      `translateX(${Math.min(x, BAR_W - 6)}px)`;

    let ahead = 0;
    try {
      if (v.buffered && v.buffered.length) ahead = v.buffered.end(v.buffered.length - 1);
    } catch (e) { ahead = 0; }
    osdBuffered.style.width = dur ? Math.round(BAR_W * Math.min(ahead, dur) / dur) + 'px' : '0';
  }

  /* Chapters as ticks, markers as bands. Drawn once, when the duration is
     known — they do not move, and rebuilding them on every frame is exactly
     the kind of work this panel cannot afford. */
  function paintTicks() {
    const dur = duration();
    if (!dur) { osdTicks.innerHTML = ''; return; }
    let html = '';
    const list = Media.chapters(item);
    let i;

    const markers = (item && item.Marker) || [];
    for (i = 0; i < markers.length; i++) {
      const at = Math.round(BAR_W * ((markers[i].startTimeOffset || 0) / 1000) / dur);
      const wide = Math.max(2, Math.round(BAR_W *
        (((markers[i].endTimeOffset || 0) - (markers[i].startTimeOffset || 0)) / 1000) / dur));
      html += `<i class="osd-band" style="left:${at}px;width:${wide}px"></i>`;
    }
    for (i = 0; i < list.length; i++) {
      if (list[i].start <= 0) continue;
      html += '<i class="osd-tick" style="left:' +
              Math.round(BAR_W * list[i].start / dur) + 'px"></i>';
    }
    osdTicks.innerHTML = html;
  }

  function showOsd() {
    paintOsd();
    osd.classList.remove('hidden');
    osd.style.opacity = '1';
    subEl.classList.add('lifted');
    clearTimeout(osdTimer);
    /* While a seek is still being aimed, the OSD is the only feedback there is,
       so it stays until the seek lands. The menu keeps it up too — it sits
       above the bar and reads as one panel. */
    osdTimer = setTimeout(() => {
      if (pending !== null || Menu.isOpen() || openPanel || focus !== 'none') { showOsd(); return; }
      osd.style.opacity = '0';
      subEl.classList.remove('lifted');
    }, 4000);
  }

  function osdShowing() { return osd.style.opacity !== '0' && !osd.classList.contains('hidden'); }

  function hint() {
    if (openPanel === 'chapters') {
      osdHint.textContent = '◀ ▶ chapter · OK jump there · BACK close';
    } else if (Menu.isOpen()) {
      osdHint.textContent = '▲ ▼ choose · OK select · BACK close';
    } else if (focus === 'row') {
      osdHint.textContent = '◀ ▶ control · OK open it · ▲ trackbar · ▼ back to playback';
    } else if (focus === 'bar') {
      osdHint.textContent = '◀ ▶ scrub · OK seek there · ▼ controls · BACK back to playback';
    } else {
      osdHint.textContent = `◀ ▶ ${NUDGE}s · ▲ trackbar · ▼ controls · 0–9 jump · ` +
                            'CH± chapter · OK pause';
    }
  }

  /* Move between the three modes. Leaving for playback forgets which button the
     row was on; the trackbar says so with the knob's ring. */
  function setFocus(to) {
    focus = to;
    if (to === 'none') ctl = -1;
    else if (to === 'row' && ctl < 0) ctl = indexOfCtl('audio');
    osdBar.classList.toggle('foc', to === 'bar');
  }

  /* ---------- choosing the audio track ----------

     The thing that is easy to get wrong, and was: on a DIRECT PLAY the server
     hands over the original file, whole, with every track still in it. The
     `audioStreamID` sent with the decision call is advice to the decision
     engine and changes not one byte of that file, so the panel goes on playing
     whichever track it prefers — the first one. Restarting playback with a
     different id therefore did nothing at all, while the OSD cheerfully named
     the track we had asked for.

     There are exactly two ways to actually be listening to a chosen track:

       1. The panel exposes audioTracks and lets us select one. Free, instant,
          no server involvement, no restart. This is the good case, and
          js/panel.js reports on the chip whether it is available.
       2. Failing that, the server has to mux the stream itself, which means
          giving up direct play — a real session on someone else's hardware,
          and on a 4K file a refusal. That is the honest price of choosing, and
          it is only paid when the panel will not choose for us. */

  /* The panel's own track list, or null when it does not have one. Only useful
     once metadata has loaded, so never cached. */
  function panelTracks() {
    const list = v.audioTracks;
    if (!list || typeof list.length !== 'number' || list.length < 2) return null;
    return list;
  }

  /* Which entry of the panel's list is this Plex stream? The file's audio
     streams and the pipeline's track list are the same tracks in the same
     order — but only if they are the same length. If they are not, we do not
     know what we are looking at, and guessing would select the wrong track
     silently, which is the bug this whole section exists to fix. */
  function panelIndexOf(st) {
    const tracks = Media.audioTracks(currentPart);
    const list = panelTracks();
    if (!list || list.length !== tracks.length) return -1;
    for (let i = 0; i < tracks.length; i++) {
      if (String(tracks[i].id) === String(st.id)) return i;
    }
    return -1;
  }

  function selectPanelTrack(n) {
    const list = panelTracks();
    if (!list || n < 0 || n >= list.length) return false;
    for (let i = 0; i < list.length; i++) {
      if (list[i]) list[i].enabled = (i === n);
    }
    /* Trust nothing: read it back. A pipeline that exposes the list read-only
       would otherwise look like a successful switch and sound like the old
       track — the exact failure being fixed. */
    return !!(list[n] && list[n].enabled);
  }

  /* Is the track named on screen the track you are hearing? Only if we chose
     it: the server muxed the stream, or the panel let us select it. */
  function audioIsOurs() {
    return transcoding || Media.audioTracks(currentPart).length < 2 || !!panelTracks();
  }

  /* The track the guard picked is a promise the masthead already made before
     OK was pressed. If the panel lets us keep that promise, keep it at once
     rather than waiting to be asked — otherwise the first thing you hear is
     whatever the file happens to list first, which on a remux is routinely
     the one track that cannot cross ARC. */
  function applyChosenTrack() {
    if (!currentAudio || transcoding) return;
    const n = panelIndexOf(currentAudio);
    if (n < 0) { paintControls(); return; }
    const list = panelTracks();
    if (list[n] && list[n].enabled) return;          // already right, say nothing
    if (selectPanelTrack(n)) {
      UI.debug(`audio set on the panel (track ${n}): ${Media.audioLabel(currentAudio)}`);
    }
    paintControls();
  }

  function chooseAudio(st) {
    if (currentAudio && String(currentAudio.id) === String(st.id)) return;
    const n = panelIndexOf(st);
    if (n >= 0 && selectPanelTrack(n)) {
      /* The good case: the panel switched it, nothing restarted, the server
         was not asked for anything. */
      currentAudio = st;
      UI.debug(`audio switched on the panel (track ${n}): ${Media.audioLabel(st)}`);
      paintControls();
      showOsd();
      return;
    }
    switchTo({ audioId: st.id, forceStream: true }, Media.audioMenuLabel(st));
  }

  /* ---------- the control row ----------

     Transport on the left, the four things that can be changed on the right.
     Each right-hand button is captioned with what is chosen NOW rather than
     what is highlighted, because the caption is what you read before deciding
     to open anything; the violet ring says which panel is open. */

  /* Inlined, as everywhere else here: the app runs from file:// on the TV, so
     there is no icon font to fetch. */

  function audioCaption() {
    return Media.audioMenuLabel(currentAudio) +
           (audioIsOurs() ? '' : ' — panel’s choice');
  }

  function subCaption() {
    return (currentSub ? Media.subLabel(currentSub) : 'off') +
           (subNote ? ` — ${subNote}` : '');
  }

  function qualityCaption() {
    return maxBitrate ? Media.bitrateLabel(maxBitrate) + ' converted'
                      : Media.versionLabel(currentMedia);
  }

  function chapterCaption() {
    const here = chapterAt(Media.chapters(item), target());
    return here ? here.title : 'none';
  }

  /* The three transport buttons, then the four choices. The order is the order
     on screen, and the index into it is what the arrows move. */
  function controls() {
    return [
      { glyph: Glyphs.rewind, run: () => { seekBy(-JUMP); } },
      { glyph: v.paused ? Glyphs.play : Glyphs.pause, run: togglePlay },
      { glyph: Glyphs.forward, run: () => { seekBy(JUMP); } },
      { id: 'audio', glyph: Glyphs.audio, caption: audioCaption() },
      { id: 'subs', glyph: Glyphs.subs, caption: subCaption() },
      { id: 'quality', glyph: Glyphs.quality, caption: qualityCaption() },
      { id: 'chapters', glyph: Glyphs.chapters, caption: chapterCaption() }
    ];
  }

  function paintControls() {
    const list = controls();
    let lh = '';
    let rh = '';
    let html;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      html = `<div class="osd-ctl${focus === 'row' && i === ctl ? ' foc' : ''}` +
             (c.id && c.id === openPanel ? ' on' : '') + '"' +
             (c.id ? ` id="osd-ctl-${c.id}"` : '') + '>' +
             '<div class="osd-btn">' + c.glyph + '</div>' +
             '<div class="osd-cap">' + UI.escapeHtml(c.caption || '') + '</div>' +
             '</div>';
      if (c.id) rh += html; else lh += html;
    }
    osdLeft.innerHTML = lh;
    osdRight.innerHTML = rh;
    hint();
  }

  function togglePlay() {
    if (v.paused) v.play(); else v.pause();
    report(v.paused ? 'paused' : 'playing');
    paintControls();
    showOsd();
  }

  /* ---------- seeking ---------- */

  /* Nudge the target. Repeats accumulate rather than each one seeking. */
  function seekBy(seconds) {
    seekTo(target() + seconds);
  }

  function seekTo(seconds) {
    const dur = duration();
    pending = Math.max(0, dur ? Math.min(seconds, dur - 2) : seconds);
    dismissSkip();
    showOsd();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(applySeek, SEEK_SETTLE);
  }

  function applySeek() {
    if (pending === null) return;
    const to = pending;
    pending = null;
    try { v.currentTime = to; } catch (e) { /* not seekable yet */ }
    report(v.paused ? 'paused' : 'playing');
    paintSub();
    showOsd();
  }

  /* A digit is the cheapest jump there is: 3 means three tenths in. The stock
     app has nothing like it and it is the fastest way past a first act. */
  function jumpToTenth(n) {
    const dur = duration();
    if (!dur) return;
    seekTo(dur * n / 10);
  }

  /* Chapter skip, falling back to a fixed jump on a file with no chapters —
     the button should always do something. */
  function chapterStep(dir) {
    const list = Media.chapters(item);
    let at = target();
    let i;
    let to = null;
    if (!list.length) { seekBy(dir * JUMP); return; }
    if (dir > 0) {
      for (i = 0; i < list.length; i++) {
        if (list[i].start > at + 1) { to = list[i].start; break; }
      }
      if (to === null) to = Math.max(0, duration() - 5);
    } else {
      /* Back once goes to the start of this chapter, again to the one before —
         which is how every disc player has behaved for twenty years. */
      for (i = list.length - 1; i >= 0; i--) {
        if (list[i].start < at - 3) { to = list[i].start; break; }
      }
      if (to === null) to = 0;
    }
    seekTo(to);
  }

  /* ---------- skip intro ----------

     The server has already analysed the film and says where the intro and the
     credits are, so there is nothing to detect here — only something to offer
     while you are inside one. OK takes it; anything else carries on. */

  let skipDismissed = null;

  function checkMarker() {
    let found = Media.markerAt(item, v.currentTime || 0);
    /* A dismissal lasts as long as you are inside the thing you dismissed, and
       no longer. Rewinding back over an intro and being refused the offer —
       because you happened to seek while it was on screen an hour ago — is not
       a decision anyone made. */
    if (skipDismissed && found !== skipDismissed) skipDismissed = null;
    if (found && skipDismissed === found) found = null;
    if (found === marker) return;
    marker = found;
    if (!marker) { skipEl.classList.add('hidden'); return; }
    skipEl.textContent = Media.markerLabel(marker) + '   ›   OK';
    skipEl.classList.remove('hidden');
  }

  function dismissSkip() {
    if (!marker) return;
    skipDismissed = marker;
    marker = null;
    skipEl.classList.add('hidden');
  }

  function takeSkip() {
    const to = (marker.endTimeOffset || 0) / 1000;
    skipDismissed = marker;
    marker = null;
    skipEl.classList.add('hidden');
    /* Applied at once rather than through the settle timer: the whole point is
       that one press gets you past it. */
    pending = null;
    clearTimeout(seekTimer);
    try { v.currentTime = to; } catch (e) { /* not seekable yet */ }
    UI.debug(`skipped to ${fmt(to)}`);
    showOsd();
  }

  /* ---------- what comes next ----------

     An episode that ends offers the one after it, and by default waits there
     for a keypress. These are someone else's servers: a chain that rolls all
     night is load on hardware we do not own, put there by someone who fell
     asleep. A season boundary never counts down at all. */

  const AUTOPLAY = [0, 5, 10, 15, 30];        // seconds; 0 is "wait for OK"
  let autoplay = null;                      // read from storage once, then cached
  let next = null;
  let nextTimer = null;
  let nextLeft = 0;

  /* How long an ended episode waits before playing the next, in seconds, or 0
     for not at all. Storage that refuses us falls back to 0, the safe way. */
  function autoplaySeconds() {
    if (autoplay !== null) return autoplay;
    let stored = 0;
    try { stored = Number(localStorage.getItem('reflex.autoplay')); } catch (e) { stored = 0; }
    autoplay = AUTOPLAY.indexOf(stored) > 0 ? stored : 0;
    return autoplay;
  }

  /* off → 5 → 10 → 15 → 30 → off, persisted. Cycling is the cheapest control a
     d-pad has, which is why the preference is a sidebar entry and not a screen. */
  function cycleAutoplay() {
    autoplay = AUTOPLAY[(AUTOPLAY.indexOf(autoplaySeconds()) + 1) % AUTOPLAY.length];
    try { localStorage.setItem('reflex.autoplay', String(autoplay)); } catch (e) { /* private mode */ }
    return autoplay;
  }

  /* 'off' or '10s' — what the sidebar entry and its toast say. */
  function autoplayLabel() {
    const secs = autoplaySeconds();
    return secs ? secs + 's' : 'off';
  }

  /* Playback ended on its own. Ask what follows before tearing anything down,
     because with nothing to offer this is an ordinary stop. */
  function offerNext() {
    if (!onNext || !item) { stop('stopped'); return; }
    const asked = item;
    onNext(item).then((found) => {
      if (item !== asked) return;            // stopped while we were asking
      if (!found || !found.episode) { stop('stopped'); return; }
      showNext(found);
    }, () => { stop('stopped'); });
  }

  /* "S1 E5 · Sundown" — where it sits in the series, then what it is called. */
  function nextLabel(ep) {
    return `S${ep.parentIndex === undefined ? '?' : ep.parentIndex}` +
           ' E' + (ep.index === undefined ? '?' : ep.index) +
           '   ·   ' + (ep.title || '');
  }

  function showNext(found) {
    next = found;
    dismissSkip();
    Menu.close();
    const ep = found.episode;
    const still = Plex.posterUrl(ep, 320, 180);
    nextStillEl.style.backgroundImage = still ? `url("${still}")` : 'none';
    nextShowEl.textContent = `Up next   ·   ${ep.grandparentTitle || ''}`;
    nextTitleEl.textContent = nextLabel(ep);
    /* Crossing into a new season always waits, whatever the setting says: it is
       exactly where an unattended chain should stop. */
    nextLeft = found.newSeason ? 0 : autoplaySeconds();
    paintNext();
    nextEl.classList.remove('hidden');
    if (nextLeft > 0) nextTimer = setInterval(tickNext, 1000);
    UI.debug(`up next: ${nextLabel(ep)}` +
             (nextLeft > 0 ? ` in ${nextLeft}s` : ' — waiting for OK'));
  }

  function paintNext() {
    nextHintEl.textContent = nextLeft > 0
      ? `Playing in ${nextLeft}s   ·   OK now   ·   BACK to stop`
      : 'OK to play   ·   BACK to stop';
  }

  function tickNext() {
    nextLeft--;
    paintNext();
    if (nextLeft <= 0) takeNext();
  }

  /* Take the panel down and kill the countdown with it. A timer that plays an
     episode onto a screen nobody is looking at is worse than no feature, so
     every way out of playback comes through here. */
  function clearNext() {
    clearInterval(nextTimer);
    nextTimer = null;
    nextLeft = 0;
    next = null;
    nextEl.classList.add('hidden');
  }

  function takeNext() {
    const ep = next && next.episode;
    const go = onPlayNext;
    clearNext();
    if (!ep || !go) { stop('stopped'); return; }
    /* The finished episode is reported stopped before the next one starts — a
       session left open on a server we do not own is the rudest thing this app
       can do. Quietly, or onExit would bounce us out mid-handover. */
    stop('stopped', true);
    go(ep);
  }

  function nextKey(code) {
    if (code === 13 || code === 415 || code === 19 || code === 179) { takeNext(); return true; }
    if (UI.isBack(code) || code === 413) { clearNext(); stop('stopped'); return true; }
    return true;                             // the offer swallows everything else
  }

  /* ---------- subtitles ----------

     Fetched as text and drawn over the video. The server does one small GET
     and nothing else — no session, no re-encode, nothing on the dashboard of a
     server we do not own. */

  function setSub(stream) {
    const token = ++subToken;
    cues = [];
    subNote = '';
    subEl.textContent = '';
    /* Clear what is drawn AND the note of what was drawn: paintSub skips a cue
       identical to the last one, so leaving the note behind means turning a
       track off and back on inside one cue draws nothing. */
    subEl.setAttribute('data-cue', '');
    subEl.classList.add('hidden');
    currentSub = stream || null;
    wantedLang = stream ? String(stream.languageCode || '') : null;
    if (!stream) { paintControls(); return; }

    if (!Media.isTextSub(stream)) {
      /* A picture of words can only reach the screen by being painted into the
         video, which is a transcode — and on a 4K file that is the one thing
         that gets the session killed. So it is refused, by name. */
      currentSub = null;
      subNote = String(stream.codec || '').toUpperCase() +
                ' is an image track — it would need the server to burn it in';
      paintControls();
      return;
    }

    subNote = 'loading…';
    paintControls();
    Plex.subtitles(server, stream).then((text) => {
      if (token !== subToken) return;
      cues = Subs.parse(text);
      subNote = cues.length ? '' : 'the track came back empty';
      UI.debug(`subtitles: ${Media.subLabel(stream)} · ${cues.length} cues`);
      paintControls();
      paintSub();
    }, (e) => {
      if (token !== subToken) return;
      currentSub = null;
      subNote = `could not be fetched (${e.message.split(' -> ').pop()})`;
      paintControls();
    });
  }

  function paintSub() {
    if (!cues.length) return;
    const text = Subs.textAt(cues, (v.currentTime || 0) + 0.05);
    if (text === subEl.getAttribute('data-cue')) return;
    subEl.setAttribute('data-cue', text);
    subEl.textContent = text;
    subEl.classList.toggle('hidden', text === '');
  }

  /* ---------- the panels ----------

     Everything the stock app makes you leave playback for. One section per
     button rather than one block of tabs, so what is on screen is what the
     button you pressed is about. */

  function audioRows() {
    const tracks = Media.audioTracks(currentPart);
    const out = [];
    for (let i = 0; i < tracks.length; i++) out.push(audioRow(tracks[i]));
    return out;
  }

  function audioRow(st) {
    return {
      label: Media.audioMenuLabel(st),
      /* Say which switches are free. When the panel owns the track list this
         is instant; otherwise it restarts against a stream the server has to
         mux, and knowing that before you press OK is the difference between a
         choice and a surprise. */
      note: (currentAudio && String(currentAudio.id) === String(st.id)) ? ''
        : (panelIndexOf(st) >= 0 ? '' : 'restarts — the server has to mux this one'),
      on: !!(currentAudio && String(currentAudio.id) === String(st.id)),
      value: () => { chooseAudio(st); }
    };
  }

  function subRows() {
    const list = Media.subtitleTracks(currentPart);
    const out = [{ label: 'Off', on: !currentSub, value: () => { setSub(null); } }];
    for (let i = 0; i < list.length; i++) out.push(subRow(list[i]));
    return out;
  }

  function subRow(st) {
    return {
      label: Media.subLabel(st),
      note: Media.isTextSub(st) ? '' : 'image track — cannot be shown without a transcode',
      on: !!(currentSub && String(currentSub.id) === String(st.id)),
      value: () => { setSub(st); }
    };
  }

  /* Quality is two different things wearing one name: another *version* of the
     film — a separate file, often the 1080p next to the 4K — and a bitrate cap,
     which is the server re-encoding this one. Both belong here because both are
     what the user means by "make this play properly", and both go through the
     guard, so the 4K rule refuses the cap and offers the other version. */
  function qualityRows() {
    const versions = (item && item.Media) || [];
    const out = [];
    let i;
    if (versions.length > 1) {
      for (i = 0; i < versions.length; i++) out.push(versionRow(versions[i], i));
    }
    const list = Media.qualities(currentMedia);
    for (i = 0; i < list.length; i++) out.push(qualityRow(list[i]));
    return out;
  }

  function versionRow(media, n) {
    return {
      label: `Version — ${Media.versionLabel(media)}`,
      on: n === mediaIndex && !maxBitrate,
      value: () => {
        if (n === mediaIndex && !maxBitrate) return;
        switchTo({ mediaIndex: n, maxBitrate: null }, Media.versionLabel(media));
      }
    };
  }

  /* What a row costs, said before OK rather than found out after it. There is
     no "Auto" here on purpose: nothing in this app follows the connection —
     Original is the file as it stands and every cap is a fixed ceiling the
     server re-encodes to. */
  function qualityNote(q) {
    if (!q.bitrate) return forceStream ? 'the server muxes this one' : 'direct play';
    if (Media.isUHD(currentMedia)) {
      return 'a 4K transcode is what gets the stream killed — this will be refused';
    }
    return `transcode · ${Media.bitrateLabel(q.bitrate)}`;
  }

  function qualityRow(q) {
    return {
      label: q.label,
      note: qualityNote(q),
      on: (q.bitrate || null) === maxBitrate,
      value: () => {
        if ((q.bitrate || null) === maxBitrate) return;
        switchTo({ maxBitrate: q.bitrate || null }, q.label);
      }
    };
  }

  /* The chapter the playhead is in, or null. The rail rings it and the caption
     names it, so both have to agree. */
  function chapterAt(list, at) {
    /* Backwards: a chapter Plex gave no end offset for would otherwise swallow
       the whole film from its start onwards. */
    for (let i = list.length - 1; i >= 0; i--) {
      if (at >= list[i].start && (!list[i].end || at < list[i].end)) return list[i];
    }
    return null;
  }

  /* Three of the four buttons open a list. A row's value is what choosing it
     does — js/menu.js draws and walks, and knows nothing about any of it. The
     builders are handed over rather than called, so the list is made when the
     panel opens and reflects where playback has got to. */
  const PANELS = {
    audio: { label: 'Audio', rows: audioRows },
    subs: { label: 'Subtitles', rows: subRows,
            note: 'Subtitles are fetched as text and drawn here, so they cost the server nothing.' },
    quality: { label: 'Quality', rows: qualityRows,
               note: 'Anything but Original asks the server to re-encode.' }
  };

  /* Open the panel belonging to one of the four right-hand buttons, anchored
     over it and clamped so the last button does not push it off the screen. */
  function openPanelFor(id) {
    if (id === 'chapters') { openChapters(); return; }
    openPanel = id;
    paintControls();
    const btn = document.getElementById(`osd-ctl-${id}`);
    menuEl.style.left =
      UI.clamp(64 + osdRight.offsetLeft + (btn ? btn.offsetLeft : 0), 64, 960) + 'px';
    Menu.open({
      host: menuEl,
      tabs: [PANELS[id]],
      onChoose: (act) => { act(); },
      onClose: () => { openPanel = null; paintControls(); showOsd(); }
    });
    showOsd();
  }

  /* ---------- the chapter rail ----------

     Cards rather than a list, because a still and a timecode say more about
     where you are going than "Chapter 7" does. Plex carries a thumbnail for
     some chapters and not others, so the picture is the only thing a card can
     lose — never its size. */

  function openChapters() {
    const list = Media.chapters(item);
    if (!list.length) { UI.toast('This file has no chapters'); return; }
    openPanel = 'chapters';
    chapSel = Math.max(0, list.indexOf(chapterAt(list, target())));
    paintChapters();
    chapEl.classList.remove('hidden');
    paintControls();
    showOsd();
  }

  function closeChapters() {
    openPanel = null;
    chapEl.classList.add('hidden');
    paintControls();
    showOsd();
  }

  function paintChapters() {
    const list = Media.chapters(item);
    let html = '';
    let shot;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      shot = c.thumb ? Plex.photoUrl(server, c.thumb, 240, 135) : '';
      html += `<div class="osd-chap${i === chapSel ? ' on' : ''}">` +
              '<div class="osd-chap-shot"' +
              (shot ? ` style="background-image: url('${shot}')"` : '') + '>' +
              '<div class="osd-chap-time">' + UI.escapeHtml(fmt(c.start)) + '</div>' +
              '</div>' +
              '<div class="osd-chap-title">' + UI.escapeHtml(c.title) + '</div>' +
              '</div>';
    }
    chapInner.innerHTML = html;
    const first = UI.clamp(chapSel - 2, 0, Math.max(0, list.length - CARDS_SHOWN));
    chapInner.style.webkitTransform = chapInner.style.transform =
      `translateX(${-first * CARD_W}px)`;
  }

  function chapterKey(code) {
    const list = Media.chapters(item);
    if (code === 37) { chapSel = (chapSel + list.length - 1) % list.length; paintChapters(); return true; }
    if (code === 39) { chapSel = (chapSel + 1) % list.length; paintChapters(); return true; }
    if (code === 13 || code === 415 || code === 19) {
      seekTo(list[chapSel].start);
      closeChapters();
      return true;
    }
    if (code === 40 || UI.isBack(code) || code === 413) { closeChapters(); return true; }
    return true;                       // the rail swallows everything else
  }

  /* Another version, a quality cap, and an audio track the panel will not
     select for us all mean the same thing: ask the server for a different
     stream and start again from here. The guard decides whether that is
     allowed, which is what keeps a quality cap on a 4K file refused. */
  function switchTo(change, what) {
    if (!onSwitch) return;
    change.at = target();
    change.subLang = wantedLang;
    if (change.audioId === undefined) change.audioId = currentAudio && currentAudio.id;
    if (change.mediaIndex === undefined) change.mediaIndex = mediaIndex;
    if (change.maxBitrate === undefined) change.maxBitrate = maxBitrate;
    /* Carried so a later switch does not silently drop back to a direct play
       and lose the track the user chose. */
    if (change.forceStream === undefined) change.forceStream = forceStream;
    /* On the hint line rather than in a caption: a caption names what IS
       chosen, and this has not happened yet. play() writes the hint back. */
    osdHint.textContent = `Switching to ${what}…`;
    showOsd();
    onSwitch(change);
  }

  /* ---------- progress ---------- */

  function report(state) {
    if (!item || !server) return;
    Plex.timeline(server, item, state, (v.currentTime || 0) * 1000, (v.duration || 0) * 1000);
  }

  /* A black screen tells you nothing, and "the panel refused it" is only one of
     the reasons this fails. Say which. */
  function mediaErrorText(err) {
    const code = err ? err.code : 0;
    const detail = err && err.message ? `  ·  ${err.message}` : '';
    if (code === 1) return `The stream was aborted.${detail}`;
    if (code === 2) return 'The network dropped the stream — the server stopped ' +
                           'answering part way through.' + detail;
    if (code === 3) return 'The panel could not decode this stream (media error 3). ' +
                           'The server said it would direct play, so the declared ' +
                           'profile in js/plex.js claims something this panel cannot ' +
                           'actually decode.' + detail;
    if (code === 4) return 'The stream would not open (media error 4) — the server ' +
                           'refused the request, or the container is one the panel ' +
                           'will not accept at all.' + detail;
    return `The stream failed (media error ${code}).${detail}`;
  }

  /* A desktop browser is not this panel, and its codec support is much
     narrower — Firefox has no AC3/E-AC3 and no HEVC at all, Chrome has no
     Matroska. Silence or a decode error on the laptop usually says nothing
     about the TV, and mistaking one for the other costs an evening. */
  function laptopNote(media) {
    if (!Config.dev) return '';
    const codec = (media && media.videoCodec) || '?';
    const container = (media && media.container) || '?';
    return '  ·  You are on the dev server, so this is a desktop browser, not ' +
           'the B8. It is playing ' + String(codec).toUpperCase() + ' in ' +
           String(container).toUpperCase() + ', and browsers do not decode AC3, ' +
           'E-AC3, HEVC or Matroska the way the panel does. Judge playback on ' +
           'the TV.';
  }

  function fail(msg) {
    const report_ = onError;
    UI.debug(`playback failed: ${msg}`);
    stop('stopped');
    if (report_) report_(msg);
  }

  function play(opts) {
    item = opts.item;
    server = opts.server;
    onExit = opts.onExit;
    onError = opts.onError;
    onSwitch = opts.onSwitch || null;
    onNext = opts.onNext || null;
    onPlayNext = opts.onPlayNext || null;
    resumeMs = opts.item.viewOffset || 0;
    clearNext();

    stalls = 0; lowest = 999; startedAt = Date.now();
    const url = opts.url || Plex.streamUrl(server, opts.part);
    osdTitle.textContent = opts.item.title || '';
    pending = null;
    clearTimeout(seekTimer);
    currentPart = opts.part;
    currentAudio = opts.audio || null;
    mediaIndex = opts.mediaIndex || 0;
    maxBitrate = opts.maxBitrate || null;
    transcoding = !!opts.transcode;
    forceStream = !!opts.forceStream;
    currentMedia = (item.Media && item.Media[mediaIndex]) || null;
    marker = null; skipDismissed = null;
    skipEl.classList.add('hidden');
    Menu.close();
    setFocus('none'); openPanel = null;
    chapEl.classList.add('hidden');
    cues = []; currentSub = null; subNote = '';
    subEl.classList.add('hidden'); subEl.textContent = '';
    subEl.setAttribute('data-cue', '');
    wantedLang = opts.subLang === undefined ? null : opts.subLang;
    paintControls();
    hint();
    v.classList.remove('hidden');

    v.onloadedmetadata = () => {
      /* Only now does currentTime mean anything. Don't resume within half a
         minute of the end — that is a film you finished. */
      if (resumeMs > 10000 && v.duration && resumeMs < (v.duration * 1000) - 30000) {
        v.currentTime = resumeMs / 1000;
      }
      paintTicks();
      applyChosenTrack();
      showOsd();
      report('playing');
      /* The subtitle track the user had before a restart, matched by language
         because a different version of the film has different stream ids. */
      if (wantedLang !== null) {
        const again = Media.pickSubtitle(currentPart, wantedLang);
        if (again) setSub(again);
      }
    };
    /* The track list is not always populated by loadedmetadata, so try again
       once the picture is actually running. */
    v.onplaying = () => { applyChosenTrack(); showOsd(); };
    /* 'waiting' is the panel telling us it has run dry. */
    v.onwaiting = () => { stalls++; };
    v.ontimeupdate = () => {
      if (osdShowing()) paintOsd();
      paintSub();
      checkMarker();
    };
    v.onended = () => { offerNext(); };
    v.onerror = () => {
      fail(mediaErrorText(v.error) + laptopNote(currentMedia));
    };

    /* preload only matters between the element existing and a src being set,
       and the src is only ever set here, at the moment we play. Leaving it at
       "none" made the browser conservative about reading ahead for no benefit. */
    v.preload = 'auto';
    v.src = url;
    v.load();
    showOsd();
    UI.debug((transcoding ? 'playing (server converting' +
              (maxBitrate ? ` at ${Media.bitrateLabel(maxBitrate)}` : '') + ') ' : 'playing ') +
             String(url).split('?')[0]);

    /* Ask directly rather than waiting on loadedmetadata, which need not fire
       on its own, and report a rejected play() rather than sitting on a black
       screen — it is otherwise completely silent. */
    const started = v.play();
    if (started && started.then) {
      started.then(null, (e) => {
        fail(`The player refused to start: ${(e && (e.name + ' ' + e.message)) || 'unknown'}` +
             '. If this is the TV, it is usually the media pipeline rejecting the ' +
             'container rather than the codec.');
      });
    }

    clearInterval(ticker);
    ticker = setInterval(() => {
      report(v.paused ? 'paused' : 'playing');
      UI.debug(health());
    }, 10000);
  }

  /* Stuttering is either the network not keeping up or the panel not decoding
     fast enough, and those want opposite fixes. The video element knows which:
     a buffer that keeps draining is bandwidth, dropped frames are decode.
     Reported every ten seconds alongside the timeline, so the debug line
     answers it without a profiler. */
  function health() {
    let ahead = 0;
    try {
      if (v.buffered && v.buffered.length) {
        ahead = Math.round(v.buffered.end(v.buffered.length - 1) - v.currentTime);
      }
    } catch (e) { ahead = -1; }

    let dropped = v.webkitDroppedFrameCount;
    let decoded = v.webkitDecodedFrameCount;
    if (dropped === undefined && v.getVideoPlaybackQuality) {
      const q = v.getVideoPlaybackQuality();
      dropped = q.droppedVideoFrames;
      decoded = q.totalVideoFrames;
    }
    const frames = (decoded === undefined) ? 'frames n/a'
      : (`dropped ${dropped}/${decoded}`);

    if (ahead >= 0 && ahead < lowest) lowest = ahead;

    return fmt(v.currentTime) + '  buffered +' + ahead + 's (low ' + lowest + 's)' +
           '  stalls ' + stalls + '  ' + frames + (v.paused ? '  PAUSED' : '');
  }

  /* Said once when playback ends, because that is when the whole picture
     exists: enough stalls on a 4K remux means the link cannot carry it, and
     the answer is the 1080p copy on the film page rather than anything here. */
  function summary() {
    const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    return `played ${mins} min · ${stalls} stall${stalls === 1 ? '' : 's'}` +
           ' · buffer low ' + (lowest === 999 ? '?' : lowest + 's');
  }

  /* quiet: tear down without telling the caller we are done — used when
     playback is about to be started again with a different track, where firing
     onExit would bounce back to the film page mid-restart. */
  function stop(state, quiet) {
    if (!item) return;
    Menu.close();
    setFocus('none'); openPanel = null;
    chapEl.classList.add('hidden');
    UI.debug(summary());
    report(state || 'stopped');
    clearInterval(ticker); ticker = null;
    clearTimeout(osdTimer);
    clearTimeout(seekTimer);
    clearNext();
    pending = null;
    subToken++;
    v.pause();
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onended = v.onerror = null;
    v.onwaiting = null;
    v.removeAttribute('src');
    v.load();
    v.classList.add('hidden');
    osd.classList.add('hidden');
    skipEl.classList.add('hidden');
    subEl.classList.add('hidden');
    marker = null; cues = [];
    const done = quiet ? null : onExit;
    item = null; server = null; onExit = null; onError = null; onSwitch = null;
    onNext = null; onPlayNext = null;
    currentPart = null; currentAudio = null; currentMedia = null; currentSub = null;
    if (done) done();
  }

  function playing() { return !!item; }

  function indexOfCtl(id) {
    const list = controls();
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return 0;
  }

  /* Move the focus onto a button and open it — what a colour key does, so the
     shortcut and the row never disagree about what is on screen. */
  function focusPanel(id) {
    setFocus('row');
    ctl = indexOfCtl(id);
    openPanelFor(id);
  }

  /* The trackbar has the four arrows once it has the focus. Scrubbing is the
     same aim-then-seek as a nudge, so holding ◀ still costs one range request;
     OK is what says "stop aiming and go there". */
  function barKey(code) {
    if (code === 37) { seekBy(-NUDGE); return true; }
    if (code === 39) { seekBy(NUDGE); return true; }
    if (code === 13 || code === 415 || code === 19) {
      if (marker) { takeSkip(); return true; }
      applySeek();
      return true;
    }
    if (code === 40) { setFocus('row'); paintControls(); showOsd(); return true; }
    if (UI.isBack(code) || code === 413) {
      if (marker) { dismissSkip(); return true; }
      setFocus('none'); paintControls(); showOsd();
      return true;
    }
    return false;                      // anything else is still playback's
  }

  /* The control row has the four arrows once it has the focus; everything else
     on the remote goes on meaning what it means during playback. OK belongs to
     the button here — the skip offer is taken with OK from playback, and BACK
     still dismisses it from the row. */
  function controlKey(code) {
    const n = controls().length;
    if (code === 37) { ctl = (ctl + n - 1) % n; paintControls(); showOsd(); return true; }
    if (code === 39) { ctl = (ctl + 1) % n; paintControls(); showOsd(); return true; }
    if (code === 13) {
      const c = controls()[ctl];
      if (c.id) openPanelFor(c.id); else c.run();
      return true;
    }
    if (code === 38) { setFocus('bar'); paintControls(); showOsd(); return true; }
    if (code === 40) { setFocus('none'); paintControls(); showOsd(); return true; }
    if (UI.isBack(code) || code === 413) {
      if (marker) { dismissSkip(); return true; }
      setFocus('none'); paintControls(); showOsd();
      return true;
    }
    return false;                      // anything else is still playback's
  }

  function key(code) {
    /* The offer owns the remote while it is up: the film has ended, so seeking
       and pausing have nothing left to act on. */
    if (next) return nextKey(code);
    if (openPanel === 'chapters') return chapterKey(code);
    if (Menu.isOpen()) return Menu.key(code);

    /* Digits jump by tenths — the cheapest way past a first act there is. */
    if (code >= 48 && code <= 57) { jumpToTenth(code - 48); return true; }

    if (focus === 'bar' && barKey(code)) return true;
    if (focus === 'row' && controlKey(code)) return true;

    switch (code) {
      case 13: case 415: case 19: case 179:      // OK / play / pause
        /* While the skip prompt is up, OK takes it. That is the one moment the
           button means something other than pause, and it is the moment you
           are reaching for it. */
        if (marker) { takeSkip(); return true; }
        togglePlay();
        return true;
      case 37:                                    // left
        seekBy(-NUDGE);
        return true;
      case 39:                                    // right
        seekBy(NUDGE);
        return true;
      case 412:                                   // rewind
        seekBy(-JUMP);
        return true;
      case 417:                                   // fast forward
        seekBy(JUMP);
        return true;
      case 38:                                    // up — the trackbar
        setFocus('bar');
        paintControls();
        showOsd();
        return true;
      case 40:                                    // down — the control row
        setFocus('row');
        paintControls();
        showOsd();
        return true;
      case 33:                                    // channel up — next chapter
        chapterStep(1);
        return true;
      case 34:                                    // channel down — previous chapter
        chapterStep(-1);
        return true;
      case 403: focusPanel('audio'); return true;     // red
      case 404: focusPanel('subs'); return true;      // green
      case 405: focusPanel('quality'); return true;   // yellow
      case 406: focusPanel('chapters'); return true;  // blue
      case 461: case 27: case 8: case 413:        // back / stop
        if (marker) { dismissSkip(); return true; }
        stop('stopped');
        return true;
    }
    return false;
  }

  return { play: play, stop: stop, playing: playing, key: key,
           autoplaySeconds: autoplaySeconds, cycleAutoplay: cycleAutoplay,
           autoplayLabel: autoplayLabel };
})();
/* Boot, and where each key goes.

   Everything else lives next door: js/browse.js holds the rows and the focus,
   js/rail.js draws them, js/detail.js is the page you land on when you pick
   something, js/guard.js decides whether a copy may be played, js/plex.js talks
   to the servers. This file is the wiring. */
(function () {
  'use strict';

  /* ---------- opening something ----------

     OK on the rail no longer plays. It opens the detail page, which lists every
     copy of the film — both servers, and every version each of them holds — and
     checks each one before you choose. Playing is a decision made there, with
     the verdict already on screen. */

  function toBrowse() { UI.show('browse'); Browse.render(); }
  function toShow() { UI.show('show'); }

  /* A film opens its detail page; a show and an episode both open the series
     page, and an episode chosen there opens the same detail page a film would. */
  function openItem(item) {
    if (!item) return;
    if (Discovery.isEntry(item)) { openDiscovered(item); return; }
    if (item.type === 'show') { openShow(item); return; }
    if (item.type === 'episode') { openEpisode(item); return; }
    openDetail(item, toBrowse);
  }

  /* A Discovery tile is a film TMDB knows about, which neither server need
     have. Resolving it is one request and resting on it has usually paid for it
     already; a title we do not hold reaches no guard and no player, so it says
     so rather than opening a page about nothing. */
  function openDiscovered(item) {
    Discovery.resolve(item).then((found) => {
      if (found) { openItem(found); return; }
      UI.message('Not in your library',
        item.title + (item.year ? ` (${item.year})` : '') +
        ' is on neither server.  ·  BACK to the rows');
    });
  }

  function openShow(entry, at) {
    ShowPage.open(entry, {
      at: at,
      onExit: toBrowse,
      onPlay: (episode, verdict) => {
        playChecked(episode, verdict, false, undefined, toShow);
      },
      /* Leaving the page by any route stops its theme. One call per route
         rather than a listener, because the failure mode is two sources on one
         ARC link — BACK goes through ShowPage's own close, and playback stops
         it in playChecked. */
      onChoose: (episode) => { ShowPage.silence(); openDetail(episode, toShow); },
      onRecap: (video) => { ShowPage.silence(); openRecap(video); }
    });
  }

  /* ---------- season recaps ----------

     A recap is a YouTube video, not library content: it never reaches Guard,
     Player or the timeline, and it opens nothing on anyone's Plex server. */

  let recapVideo = null;         // playing in the overlay, or null
  let recapOffer = null;         // the panel refused it; OK opens the app instead
  let recapTimer = null;

  /* Chromium 53 is nine years old and YouTube's embed drops old browsers over
     time, so an embed that never loads is a real outcome, not a bug: it falls
     back to the app that can play it rather than sitting on a black screen. */
  function openRecap(video) {
    const frame = document.getElementById('recap-frame');
    recapVideo = video;
    clearTimeout(recapTimer);
    recapTimer = setTimeout(() => { recapFailed('did not load'); }, 8000);
    frame.onload = () => { clearTimeout(recapTimer); };
    frame.onerror = () => { recapFailed('would not load'); };
    frame.src = Config.youtubeEmbedBase + video.id + '?autoplay=1';
    document.getElementById('recap').classList.remove('hidden');
  }

  function closeRecap() {
    const frame = document.getElementById('recap-frame');
    clearTimeout(recapTimer);
    frame.onload = null;
    frame.onerror = null;
    frame.src = 'about:blank';                 // stops it playing on the way out
    document.getElementById('recap').classList.add('hidden');
    recapVideo = null;
  }

  function recapFailed(why) {
    const video = recapVideo;
    if (!video) return;
    closeRecap();
    recapOffer = video;
    UI.message(`This panel ${why}`, video.title +
               '  ·  OK opens it in the YouTube app  ·  BACK to the recaps');
  }

  /* webOS only; on the laptop there is no app to hand it to. */
  function launchYouTube(id) {
    if (!window.webOS || !window.webOS.service) return;
    window.webOS.service.request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: { id: 'youtube.leanback.v4', params: { contentTarget: `v=${id}` } }
    });
  }

  /* An episode is never a dead end: it opens its series at that episode, so the
     next one is one keypress away. Resolving the series takes a request or two,
     hence the toast — and if it cannot be resolved, its own page is better than
     nothing happening. */
  function openEpisode(item) {
    UI.toast(`Opening ${item.grandparentTitle || 'series'}…`);
    Shows.entryFor(item).then((entry) => {
      if (!entry) {
        UI.debug(`no series for ${item.grandparentTitle || item.ratingKey}`);
        openDetail(item, toBrowse);
        return;
      }
      openShow(entry, { season: item.parentIndex, episode: item.index });
    }, (e) => {
      UI.debug(`series: ${e.message}`);
      openDetail(item, toBrowse);
    });
  }

  function openDetail(item, back) {
    if (!item) return;
    Detail.open(item, {
      /* isExtra comes from the page: a trailer is played, but it is not the
         film and must not inherit its resume position.

         Stopping returns to this page rather than past it — the page is where
         you pick another copy, or the next extra.

         The verdict is the one the page's buttons already put through the
         guard, and subLang is the subtitle language they chose, so playback
         starts on exactly what those buttons said it would.

         resumeAt is 0 when the page's second play was pressed and undefined
         when Play was, which is the difference between starting again and
         picking up. */
      onPlay: (entry, verdict, isExtra, subLang, resumeAt) => {
        playChecked(entry, verdict, isExtra, resumeAt,
                    () => { openDetail(item, back); }, subLang);
      },
      onExit: back || toBrowse
    });
  }

  /* The verdict has already been through Guard, so by here we know the server
     will serve it and that it is not a 4K transcode. Nothing else reaches
     Player.

     `back` is where stopping returns to — the show page for an episode, the
     film's own page otherwise — so the next episode is one press away rather
     than a search away.

     `subLang` is the subtitle language that was on before a restart. Both
     survive a switch of audio track, version or quality, because a switch is
     a restart and neither of them should be lost to it. */
  function playChecked(item, verdict, isExtra, resumeAt, back, subLang) {
    /* Before anything touches the video element: a series theme and playback
       must never share the ARC link. */
    ShowPage.silence();
    if (!verdict || !verdict.ok) return;
    const md = verdict.md;
    const server = Servers.of(md);
    /* Only an episode has a next. A film does not, and a trailer or an extra is
       not the thing you sat down to watch. */
    const hasNext = !isExtra && md.type === 'episode';
    const goBack = back || (() => { openDetail(item, toBrowse); });
    /* A trailer is not the film: resuming it 40 minutes in would be absurd. */
    md.viewOffset = isExtra ? 0
      : (resumeAt !== undefined ? resumeAt * 1000 : (item.viewOffset || md.viewOffset || 0));
    UI.debug(`starting at ${Math.round(md.viewOffset / 1000)}s`);
    UI.show('player');
    Player.play({
      server: server,
      item: md,
      part: verdict.part,
      audio: verdict.audio,
      mediaIndex: verdict.mediaIndex || 0,
      maxBitrate: verdict.maxBitrate || null,
      /* Set when this stream is being muxed by the server purely so that a
         chosen audio track is actually the one playing — see js/player.js. */
      forceStream: !!verdict.forceStream,
      /* Which subtitle language was on before a restart. By language, not by
         stream id: another version of the film is a different file with
         different ids, and "French" is what the user chose. */
      subLang: subLang,
      /* Audio, another version, and a quality cap are all the same move:
         ask the server for a different stream and start again from here. The
         panel picks its own track out of a direct-played file, so there is
         nothing to switch client-side. Subtitles are not here — they are drawn
         over the video and never restart anything. */
      onSwitch: (change) => {
        Guard.check(verdict.md, change.mediaIndex, change.audioId,
                    { maxBitrate: change.maxBitrate, forceStream: change.forceStream })
          .then((v2) => {
            if (!v2.ok) {
              /* Refusing a switch must not end the film. Say why in a line and
                 leave what is already playing alone — the full explanation is
                 on the detail page, and stopping playback to deliver it is a
                 worse answer than not switching. */
              UI.toast(`Kept as it was — ${Guard.label(v2)}`);
              UI.debug(`switch refused: ${Guard.refusal(item, v2)[1]}`);
              return;
            }
            Player.stop('stopped', true);
            playChecked(item, v2, isExtra, change.at, back, change.subLang);
          });
      },
      /* Direct play reads the file itself. Otherwise the server has to serve a
         converted stream, which means HLS and an actual session on it. */
      url: verdict.transcode
        ? Plex.transcodeUrl(server, md, verdict.mediaIndex || 0, 0,
                            verdict.audio && verdict.audio.id,
                            { maxBitrate: verdict.maxBitrate,
                              forceStream: verdict.forceStream })
        : null,
      transcode: !!verdict.transcode,
      /* What the player offers when this one ends, and what it does when the
         offer is taken. Kept apart because finding the next episode costs a
         request or two and playing it has to go through the guard. */
      onNext: hasNext ? Shows.nextAfter : null,
      onPlayNext: hasNext ? ((episode) => { playNext(episode, goBack); }) : null,
      onExit: goBack,
      onError: (msg) => { UI.message('Playback failed', msg); }
    });
  }

  /* The next episode is not a special case: it may be a 4K remux the server
     would refuse, and finding that out by starting a session is exactly what
     the guard exists to prevent. A refusal says why and goes back to the
     series rather than leaving a black screen. */
  function playNext(episode, back) {
    Guard.check(episode).then((v) => {
      if (!v.ok) {
        UI.toast(`Not playing ${episode.title || 'the next one'} — ${Guard.label(v)}`);
        UI.debug(`next refused: ${Guard.refusal(episode, v)[1]}`);
        back();
        return;
      }
      playChecked(episode, v, false, 0, back);
    });
  }

  /* ---------- keys ---------- */

  function onKey(e) {
    const code = e.keyCode;
    let handled;

    if (Player.playing()) {
      if (Player.key(code)) e.preventDefault();
      return;
    }

    /* The recap overlay sits over the show page, which is still the view: BACK
       closes it and leaves the rail exactly where it was. */
    if (recapVideo) {
      if (UI.isBack(code)) { closeRecap(); e.preventDefault(); }
      return;
    }

    switch (UI.view()) {
      case 'search':  handled = Browse.searchKey(code); break;
      case 'devices': handled = Devices.key(code); break;
      case 'detail':  handled = Detail.key(code); break;
      case 'show':    handled = ShowPage.key(code); break;
      case 'message': handled = messageKey(code); break;
      case 'browse':  handled = Browse.key(code); break;
      default:        handled = false;             // the link screen waits, that is all
    }
    if (handled) e.preventDefault();
  }

  /* Back from a message goes where you came from — the detail page if one is
     open, which is where a refusal is most likely to have come from. */
  function messageKey(code) {
    if (!UI.isBack(code) && code !== UI.KEY.OK) return false;
    /* The offer of the YouTube app: OK takes it, BACK declines, and either way
       the show page and its recaps are what is behind this message. */
    if (recapOffer) {
      const video = recapOffer;
      recapOffer = null;
      if (code === UI.KEY.OK) launchYouTube(video.id);
      UI.show('show');
      return true;
    }
    if (!Plex.hasToken()) doLink();
    else if (Detail.current()) UI.show('detail');
    else if (ShowPage.current()) UI.show('show');
    else toBrowse();
    return true;
  }

  function exitApp() {
    if (window.webOS && window.webOS.platformBack) window.webOS.platformBack();
    else window.close();
  }

  /* ---------- boot ---------- */

  function doLink() {
    UI.show('link');
    UI.debug('requesting a pin from plex.tv…');
    Plex.linkStart().then((pin) => {
      document.getElementById('link-code').textContent = pin.code;
      UI.debug(`pin ${pin.id} · client ${String(Plex.state.clientId).substring(0, 8)}` +
               ' · code ' + pin.code);
      return Plex.linkPoll(pin.id, Date.now() + 15 * 60 * 1000, UI.debug);
    }).then((token) => {
      if (!token) {                          // pin expired, issue a fresh one
        UI.debug('pin expired after 15 min, requesting another');
        doLink();
        return;
      }
      UI.show('browse');
      start();
    }).catch((e) => {
      UI.message('Could not reach plex.tv', e.message + '  ·  BACK to retry');
    });
  }

  function start() {
    UI.show('browse');
    /* Paint from cache before any network work — the whole point of the app. */
    Cached.sections.get().then((cached) => {
      if (cached && cached.length && Servers.count()) {
        Browse.loadSection(Browse.setSections(rehydrate(cached)), false);
      }
      return Plex.discover();
    }).then((servers) => {
      UI.debug(`servers: ${servers.map((sv) => { return sv.name; }).join(', ')}`);
      /* Each server's own section list. They may not agree on what exists —
         Browse folds them by type into one Movies and one TV Shows. */
      return Promise.all(servers.map((sv) => {
        return Plex.sections(sv).then((secs) => {
          return { server: sv, sections: secs };
        });
      }));
    }).then((perServer) => {
      const any = perServer.filter((r) => { return r.sections.length; });
      if (!any.length) {
        UI.message('No libraries', 'Neither server shares a film or show section.');
        return;
      }
      Cached.sections.put(perServer.map((r) => {
        return { serverId: r.server.id, sections: r.sections };
      }));
      Browse.loadSection(Browse.setSections(perServer), true);
    }).catch(startFailed);
  }

  /* Cached sections name their server by id; turn them back into the server
     objects discovery handed us. A server that has since gone is dropped. */
  function rehydrate(cached) {
    const out = [];
    for (let i = 0; i < cached.length; i++) {
      const server = Servers.get(cached[i].serverId);
      if (server) out.push({ server: server, sections: cached[i].sections });
    }
    return out;
  }

  function startFailed(e) {
    UI.debug(`start failed: ${e.message}`);
    /* Match the status precisely — a bare '401' also appears inside URLs, and
       signing out on a false positive dumps the user back to a fresh code with
       no explanation, which looks exactly like a login loop. */
    if (/-> 40[13]$/.test(e.message)) {
      /* Only plex.tv can invalidate the login. A 401 from a media server means
         that server's token is stale — rediscover, don't make the user link
         again. Conflating the two is what turned one bug into a repeating
         login loop. */
      if (e.message.indexOf(Config.plexTvBase) >= 0) {
        Plex.signOut();
        UI.message('Plex rejected the login', e.message +
          '  ·  The stored login is no longer valid. BACK to link again.');
      } else {
        Plex.forgetServers();
        UI.message('A server rejected the token', e.message +
          '  ·  Dropped the cached servers. BACK to retry.');
      }
      return;
    }
    if (!Browse.hasRows()) UI.message('Could not reach the servers', e.message + '  ·  BACK to retry');
    else UI.toast('Offline — showing cache');
  }

  /* Does persistence actually work here? If not, every launch is a first
     launch, which looks like a login loop. */
  function storageSelfTest() {
    let ok;
    try {
      localStorage.setItem('selftest', 'y');
      ok = localStorage.getItem('selftest') === 'y';
      localStorage.removeItem('selftest');
    } catch (e) {
      UI.debug(`localStorage THROWS: ${e.message}`);
      return;
    }
    UI.debug(`localStorage ${ok ? 'ok' : 'SILENTLY DROPS WRITES'}` +
             ' · token ' + (Plex.hasToken() ? 'present' : 'absent') +
             (Config.dev ? ' · dev server' : ''));
  }

  window.onerror = (msg, url, line) => {
    UI.debug(`JS ERROR ${msg} @${String(url).split('/').pop()}:${line}`);
    return false;
  };

  Rail.build();
  Browse.init({ onOpen: openItem, onExit: exitApp });
  document.addEventListener('keydown', onKey, false);
  Plex.init();
  Devices.init();
  storageSelfTest();
  if (Plex.hasToken()) start(); else doLink();
})();
