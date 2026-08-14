/* A fake plex.tv and two fake Plex Media Servers, good enough to run the whole
   app against. Runs on Node only — the Chromium 53 constraint does not apply.

   Everything the app calls is here, and nothing else is. If the app starts
   calling a new endpoint, this file is where you find out, because the mock
   answers 404 and says so on the console.

   Prefixes:
     /__plextv/...   stands in for https://plex.tv   (Config.plexTvBase)
     /__plex/...     the "Main" media server
     /__plex2/...    the "Backup" media server, sharing much of the library */
'use strict';

const fs = require('fs');
const path = require('path');
const library = require('./library');
const buildLibrary = library.build;

const TOKEN = 'mock-account-token';
const MACHINE_TOKEN = { 1: 'mock-server-token-main', 2: 'mock-server-token-backup' };

/* Three devices in the history. Two are "ours", the third is there so the
   device claim screen has something to exclude. */
const DEVICES = [
  { id: '1', name: 'Living room (B8)', platform: 'webOS' },
  { id: '2', name: 'iPhone', platform: 'iOS' },
  { id: '3', name: 'Attic Fire TV', platform: 'Android' }
];

function create(opts) {
  const log = opts.log || function () {};
  const lib = buildLibrary({ films: opts.films });
  const pins = {};
  let nextPin = 4000;

  /* Continue watching and history, per server. A film held by both servers can
     be part-watched on either — Plex syncs the position between them, so the
     app has to treat them as one entry. */
  lib.servers.forEach(function (srv) {
    const list = srv.items['1'];
    srv.deck = [];
    srv.history = [];
    for (let i = 0; i < list.length && srv.deck.length < 6;
         i += Math.max(1, Math.floor(list.length / 5))) {
      const m = JSON.parse(JSON.stringify(list[i]));
      m.viewOffset = Math.floor(m.duration * (0.1 + (i % 7) / 10));
      m.lastViewedAt = 1720000000 + i;
      srv.deck.push(m);
    }
    /* Part-watched episodes too — onDeck on a real server is mostly these, and
       an episode is a different shape from a film: it needs its show's name and
       its season and episode numbers to make any sense on screen. */
    srv.items['3'].slice(0, 4).forEach(function (show, n) {
      const eps = srv.episodesByShow[show.ratingKey] || [];
      const ep = eps[Math.min(2 + n, eps.length - 1)];
      if (!ep) return;
      const m = JSON.parse(JSON.stringify(ep));
      m.viewOffset = Math.floor(m.duration * (0.2 + (n % 5) / 10));
      m.lastViewedAt = 1720000500 + n;
      srv.deck.push(m);
    });
    srv.deck.forEach(function (m, i) {
      srv.history.push({
        ratingKey: m.ratingKey, title: m.title, type: 'movie',
        viewedAt: 1720000000 - i * 3600,
        deviceID: Number(DEVICES[i % DEVICES.length].id), accountID: 1
      });
    });
    list.slice(0, 60).forEach(function (m, i) {
      srv.history.push({
        ratingKey: m.ratingKey, title: m.title, type: 'movie',
        viewedAt: 1719000000 - i * 3600,
        deviceID: Number(DEVICES[i % DEVICES.length].id), accountID: 1
      });
    });
    srv.history.sort(function (a, b) { return b.viewedAt - a.viewedAt; });
  });

  function container(fields) {
    const mc = { size: 0, identifier: 'com.plexapp.plugins.library' };
    Object.keys(fields || {}).forEach(function (k) { mc[k] = fields[k]; });
    return { MediaContainer: mc };
  }

  function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(text)
    });
    res.end(text);
  }

  function slice(list, q) {
    const start = Number(q['X-Plex-Container-Start'] || 0);
    const sizeRaw = q['X-Plex-Container-Size'];
    const size = sizeRaw === undefined ? list.length : Number(sizeRaw);
    return { total: list.length, page: list.slice(start, start + size) };
  }

  const TYPE = { '1': 'movie', '2': 'show', '3': 'season', '4': 'episode' };

  function filtered(srv, sectionKey, q) {
    let list = srv.items[sectionKey] || [];
    /* type=1 is movies, type=2 is shows. Asking a section for the wrong type is
       a client bug, and answering nothing is how a real server would say so. */
    if (q.type && TYPE[String(q.type)]) {
      list = list.filter(function (m) { return m.type === TYPE[String(q.type)]; });
    }
    /* Only the filters the app actually sends. contentRating arrives as a
       comma-separated list, applied server side — see Plex.items. */
    if (q.contentRating) {
      const allow = {};
      String(q.contentRating).split(',').forEach(function (r) { allow[r] = true; });
      list = list.filter(function (m) { return m.contentRating && allow[m.contentRating]; });
    }
    return list;
  }

  /* The list endpoints carry Media but not Stream, exactly like a real server —
     which is why the app has to fetch metadata to know the audio tracks. */
  function stripStreams(item) {
    const copy = JSON.parse(JSON.stringify(item));
    delete copy._profile;
    delete copy._film;
    if (copy.Media && copy.Media[0] && copy.Media[0].Part) {
      copy.Media[0].Part.forEach(function (p) { delete p.Stream; });
    }
    return copy;
  }

  /* ---------- posters ---------- */

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function poster(srv, res, q) {
    const url = String(q.url || '');
    const w = Number(q.width || 160), h = Number(q.height || 240);

    /* Cast photos: a disc with initials, enough to lay the row out. */
    const person = url.match(/\/people\/(\d+)\/([^?]+)/);
    if (person) {
      const name = decodeURIComponent(person[2]);
      const initials = name.split(' ').map(function (p) { return p[0]; }).join('');
      const hue = (name.charCodeAt(0) * 11 + name.length * 37) % 360;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" ' +
        'viewBox="0 0 120 120"><rect width="120" height="120" fill="hsl(' + hue + ',24%,24%)"/>' +
        '<text x="60" y="74" text-anchor="middle" font-family="Helvetica,Arial" ' +
        'font-size="44" fill="#d8d8de">' + escapeXml(initials) + '</text></svg>');
      return;
    }

    const m = url.match(/\/library\/metadata\/(\d+)\//);
    const item = m ? srv.byKey[m[1]] : null;
    const art = url.indexOf('/art/') >= 0;
    /* Films key off the film, shows and their episodes off the show, so a
       show's episodes look like they belong together. */
    const subject = item ? lib.subject(item) : null;
    const hue = subject ? (subject.i * 37 + (item.type === 'movie' ? 0 : 140)) % 360 : 210;

    if (art) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" ' +
        'viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="hsl(' + hue + ',40%,26%)"/>' +
        '<stop offset="1" stop-color="hsl(' + ((hue + 40) % 360) + ',30%,10%)"/></linearGradient>' +
        '</defs><rect width="320" height="180" fill="url(#g)"/></svg>');
      return;
    }

    const title = item ? item.title : '?';
    /* An episode is identified by its number, not the year of its show. */
    const year = item && item.type === 'episode'
      ? 'S' + item.parentIndex + 'E' + item.index
      : (item ? item.year : '');
    const words = title.split(' ');
    let lines = [], line = '';
    words.forEach(function (word) {
      if ((line + ' ' + word).trim().length > 11) { lines.push(line.trim()); line = word; }
      else line = (line + ' ' + word).trim();
    });
    if (line) lines.push(line);
    lines = lines.slice(0, 4);

    const text = lines.map(function (l, i) {
      return '<text x="12" y="' + (46 + i * 26) + '" font-family="Helvetica,Arial" ' +
             'font-size="21" fill="#f4f4f6">' + escapeXml(l) + '</text>';
    }).join('');

    /* A corner flash in the server's colour, so which copy you are looking at
       is obvious in a screenshot. */
    const flash = srv.spec.index === 1 ? '#2f6f4f' : '#6f4f2f';

    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" ' +
      'viewBox="0 0 160 240"><rect width="160" height="240" fill="hsl(' + hue + ',34%,26%)"/>' +
      '<rect y="196" width="160" height="44" fill="rgba(0,0,0,0.35)"/>' + text +
      '<rect x="140" y="0" width="20" height="20" fill="' + flash + '"/>' +
      '<text x="12" y="224" font-family="Helvetica,Arial" font-size="18" ' +
      'fill="rgba(255,255,255,0.6)">' + year + '</text></svg>');
  }

  /* ---------- the decision endpoint ---------- */

  /* The rule the real server enforces, near enough: it will happily direct play
     anything our declared profile covers, and it will transcode when asked for
     something the profile does not list. Getting this wrong in the app is what
     lands a transcode on someone else's dashboard, so the mock is deliberately
     strict about it. */
  function decision(srv, res, q) {
    const m = String(q.path || '').match(/\/library\/metadata\/(\d+)/);
    const item = m ? srv.byKey[m[1]] : null;
    const extra = item ? null : (m ? library.resolveExtra(srv.byKey, m[1]) : null);
    if (!item && !extra) { json(res, 404, container({ size: 0 })); return; }

    const full = extra || lib.fullMetadata(item);
    const part = full.Media[0].Part[0];
    const streams = part.Stream;
    const video = streams.filter(function (s) { return s.streamType === 1; })[0];

    let audio = null;
    if (q.audioStreamID) {
      audio = streams.filter(function (s) { return String(s.id) === String(q.audioStreamID); })[0] || null;
    }
    if (!audio) audio = streams.filter(function (s) { return s.streamType === 2 && s.selected; })[0];

    let verdict = 'directplay';
    let text = '';

    /* The quality menu. Asking for a bitrate cap IS asking for a re-encode, so
       the server says so — which is what makes the app refuse a capped 4K
       stream rather than starting one and being killed. */
    if (Number(q.maxVideoBitrate || 0) > 0) {
      verdict = 'transcode';
      text = 'Conversion required. Video: Bitrate exceeds the requested maximum (' +
             q.maxVideoBitrate + ' kbps).';
    } else if (video.codec === 'vc1' || full.Media[0].container === 'avi') {
      verdict = 'transcode';
      text = 'Conversion required. Video: Unsupported codec (' + video.codec +
             '). Container: Unsupported container (' + full.Media[0].container + ').';
    } else if (audio && (audio.codec === 'truehd' ||
               (audio.codec === 'dca' && String(audio.profile || '').indexOf('ma') === 0))) {
      verdict = 'transcode';
      text = 'Conversion required. Audio: Unsupported codec (' + audio.codec + ').';
    }

    log(srv.name + ' decision ' + full.title + ' audio=' + (audio ? audio.codec : 'none') +
        ' -> ' + verdict);

    part.decision = verdict;
    json(res, 200, container({
      size: 1,
      transcodeDecisionText: text,
      generalDecisionText: text,
      mdeDecisionText: text,
      directPlayDecisionCode: verdict === 'directplay' ? 1000 : 3000,
      Metadata: [full]
    }));
  }

  /* ---------- the stream itself ---------- */

  /* There is no way to synthesise a video file here, so playback uses one you
     supply: npm run fixture, or drop any browser-playable file at
     dev/fixtures/sample.mp4. Without one the player takes its error path, which
     is worth seeing at least once too. */
  function streamFile(req, res) {
    const dir = path.join(__dirname, 'fixtures');
    let file = null;
    ['sample.mp4', 'sample.webm', 'sample.mkv'].forEach(function (name) {
      if (!file && fs.existsSync(path.join(dir, name))) file = path.join(dir, name);
    });
    if (!file) {
      log('stream requested but there is no dev/fixtures/sample.* — the player ' +
          'will show its media-error path. npm run fixture');
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no dev/fixtures/sample.* — run npm run fixture');
      return;
    }
    const size = fs.statSync(file).size;
    const type = file.slice(-4) === 'webm' ? 'video/webm' : 'video/mp4';
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      });
      fs.createReadStream(file, { start: start, end: end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }

  /* ---------- plex.tv ---------- */

  function plexTv(req, res, pathname, q, origin) {
    if (pathname === '/api/v2/pins' && req.method === 'POST') {
      const id = nextPin++;
      pins[id] = { code: 'MOCK', polls: 0 };
      log('pin ' + id + ' issued, code MOCK (claims itself after ' + opts.pinPolls + ' polls)');
      json(res, 201, { id: id, code: 'MOCK', authToken: null });
      return true;
    }
    const pin = pathname.match(/^\/api\/v2\/pins\/(\d+)$/);
    if (pin) {
      const p = pins[pin[1]];
      if (!p) { json(res, 404, {}); return true; }
      p.polls++;
      json(res, 200, { id: Number(pin[1]), code: p.code,
                       authToken: p.polls > opts.pinPolls ? TOKEN : null });
      return true;
    }
    if (pathname === '/api/v2/resources') {
      json(res, 200, lib.servers.map(function (srv, n) {
        const conns = [];
        /* A dead connection first on the first server, so discovery's race is
           doing something. */
        if (n === 0) conns.push({ uri: 'http://10.255.255.1:32400', local: true, relay: false });
        conns.push({ uri: origin + srv.prefix, local: false, relay: false });
        conns.push({ uri: 'https://relay' + n + '.example.invalid', local: false, relay: true });
        return {
          name: srv.name,
          product: 'Plex Media Server',
          clientIdentifier: srv.machineId,
          provides: 'server',
          owned: false,
          accessToken: MACHINE_TOKEN[srv.spec.index],
          connections: conns
        };
      }));
      return true;
    }
    return false;
  }

  /* ---------- a media server ---------- */

  function server(srv, req, res, pathname, q) {
    if (pathname === '/identity') {
      json(res, 200, container({ machineIdentifier: srv.machineId, version: '1.40.0.0-mock' }));
      return true;
    }

    if (pathname === '/library/sections') {
      json(res, 200, container({
        size: srv.sections.length,
        Directory: srv.sections.map(function (s) {
          return { key: s.key, title: s.title, type: s.type, updatedAt: s.updatedAt,
                   agent: 'tv.plex.agents.movie', scanner: 'Plex Movie' };
        })
      }));
      return true;
    }

    let m = pathname.match(/^\/library\/sections\/(\w+)\/all$/);
    if (m) {
      const list = filtered(srv, m[1], q);
      const cut = slice(list, q);
      json(res, 200, container({
        size: cut.page.length, totalSize: cut.total,
        offset: Number(q['X-Plex-Container-Start'] || 0),
        Metadata: cut.page.map(stripStreams)
      }));
      return true;
    }

    m = pathname.match(/^\/library\/sections\/(\w+)\/contentRating$/);
    if (m) {
      const ratings = srv.contentRatings(m[1]);
      json(res, 200, container({
        size: ratings.length,
        Directory: ratings.map(function (r) { return { key: r, title: r }; })
      }));
      return true;
    }

    m = pathname.match(/^\/hubs\/sections\/(\w+)$/);
    if (m) {
      const list = srv.items[m[1]] || [];
      const kind = list.length ? list[0].type : 'movie';
      const byAdded = list.slice().sort(function (a, b) { return b.addedAt - a.addedAt; });
      const byYear = list.slice().sort(function (a, b) { return b.year - a.year; });
      json(res, 200, container({
        size: 4,
        Hub: [
          { title: 'Recently Added', hubIdentifier: 'recentlyAdded', type: kind,
            Metadata: byAdded.slice(0, 20).map(stripStreams) },
          { title: kind === 'show' ? 'Recently Aired' : 'Recently Released',
            hubIdentifier: 'newest', type: kind,
            Metadata: byYear.slice(0, 20).map(stripStreams) },
          { title: 'Top Rated', hubIdentifier: 'topRated', type: kind,
            Metadata: list.slice(10, 30).map(stripStreams) },
          /* A hub of a type the app cannot show, to prove it skips it. */
          { title: 'Directors', hubIdentifier: 'director', type: 'director', Metadata: [] }
        ]
      }));
      return true;
    }

    if (pathname === '/library/onDeck') {
      json(res, 200, container({ size: srv.deck.length, Metadata: srv.deck.map(stripStreams) }));
      return true;
    }

    if (pathname === '/hubs/search') {
      const needle = String(q.query || '').toLowerCase();
      const limit = Number(q.limit || 40);
      function match(list) {
        return list.filter(function (item) {
          return item.title.toLowerCase().indexOf(needle) >= 0;
        }).slice(0, limit).map(stripStreams);
      }
      json(res, 200, container({
        size: 3,
        Hub: [
          { title: 'Movies', type: 'movie', Metadata: match(srv.items['1']) },
          { title: 'Shows', type: 'show', Metadata: match(srv.items['3']) },
          { title: 'People', type: 'actor', Metadata: [] }
        ]
      }));
      return true;
    }

    if (pathname === '/status/sessions/history/all') {
      const cut = slice(srv.history, q);
      json(res, 200, container({ size: cut.page.length, totalSize: cut.total, Metadata: cut.page }));
      return true;
    }

    if (pathname === '/devices') {
      json(res, 200, container({
        size: DEVICES.length,
        Device: DEVICES.map(function (d) {
          return { id: Number(d.id), name: d.name, platform: d.platform,
                   clientIdentifier: 'client-' + d.id };
        })
      }));
      return true;
    }

    if (pathname === '/library/all') {
      const hit = srv.byGuid[q.guid];
      json(res, 200, container({ size: hit ? 1 : 0, Metadata: hit ? [stripStreams(hit)] : [] }));
      return true;
    }

    /* The show hierarchy. /children on a show gives its seasons; on a season,
       its episodes. This is how a show is drilled into without ever asking for
       a whole library's worth of episodes. */
    m = pathname.match(/^\/library\/metadata\/(\d+)\/children$/);
    if (m) {
      const parent = srv.byKey[m[1]];
      const kids = srv.children[m[1]] || [];
      if (!parent) { json(res, 404, container({ size: 0 })); return true; }
      const cut = slice(kids, q);
      json(res, 200, container({
        size: cut.page.length,
        totalSize: cut.total,
        title1: parent.type === 'show' ? parent.title : parent.parentTitle,
        title2: parent.type === 'show' ? '' : parent.title,
        parentTitle: parent.title,
        key: parent.ratingKey,
        Metadata: cut.page.map(stripStreams)
      }));
      return true;
    }

    /* Every episode of a show, in order — what "play next" needs. */
    m = pathname.match(/^\/library\/metadata\/(\d+)\/allLeaves$/);
    if (m) {
      const eps = srv.episodesByShow[m[1]] || [];
      const cut = slice(eps, q);
      json(res, 200, container({ size: cut.page.length, totalSize: cut.total,
                                 Metadata: cut.page.map(stripStreams) }));
      return true;
    }

    m = pathname.match(/^\/library\/metadata\/(\d+)$/);
    if (m) {
      const item = srv.byKey[m[1]];
      if (!item) {
        /* Extras are addressable in their own right, and that is how the app
           gets their streams. */
        const extra = library.resolveExtra(srv.byKey, m[1]);
        if (extra) { json(res, 200, container({ size: 1, Metadata: [extra] })); return true; }
        json(res, 404, container({ size: 0 }));
        return true;
      }
      const deckHit = srv.deck.filter(function (d) { return d.ratingKey === item.ratingKey; })[0];
      const full = lib.fullMetadata(item);
      if (deckHit) full.viewOffset = deckHit.viewOffset;
      json(res, 200, container({ size: 1, Metadata: [full] }));
      return true;
    }

    /* A text subtitle track, handed over as a file. This is the entire cost of
       subtitles in this app: one GET, no session, nothing to burn in. An image
       track has no text to give, and answering 415 is how the app finds out —
       though it should never ask, because Media.isTextSub stops it first. */
    m = pathname.match(/^\/library\/streams\/(\d+)$/);
    if (m) {
      const srt = library.subtitleFile(m[1]);
      if (!srt) {
        log(srv.name + ' subtitle ' + m[1] + ' is an image track — refused');
        res.writeHead(415, { 'Content-Type': 'text/plain',
                             'Access-Control-Allow-Origin': '*' });
        res.end('image subtitles cannot be served as text');
        return true;
      }
      log(srv.name + ' subtitle ' + m[1] + ' fetched');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8',
                           'Access-Control-Allow-Origin': '*',
                           'Content-Length': Buffer.byteLength(srt) });
      res.end(srt);
      return true;
    }

    if (pathname === '/photo/:/transcode') { poster(srv, res, q); return true; }
    if (pathname === '/video/:/transcode/universal/decision') { decision(srv, res, q); return true; }
    if (pathname.indexOf('/library/parts/') === 0) { streamFile(req, res); return true; }

    /* A real server answers this with HLS, which a desktop browser will not
       play — so the harness serves the same fixture instead. It proves the app
       reaches for the converted stream when the verdict says to; whether the
       panel plays actual HLS is a question only the TV can answer. */
    if (pathname.indexOf('/video/:/transcode/universal/start') === 0) {
      log(srv.name + ' transcode session requested (the harness serves the fixture)');
      streamFile(req, res);
      return true;
    }

    if (pathname === '/:/timeline') {
      log(srv.name + ' timeline ' + q.state + ' ' +
          Math.round(Number(q.time || 0) / 1000) + 's');
      json(res, 200, container({ size: 0 }));
      return true;
    }

    return false;
  }

  return {
    library: lib,
    token: TOKEN,
    /* Returns true if it answered. Longest prefix first: /__plex2 also starts
       with /__plex. */
    handle: function (req, res, pathname, query, origin) {
      if (pathname.indexOf('/__plextv') === 0) {
        return plexTv(req, res, pathname.slice('/__plextv'.length) || '/', query, origin);
      }
      const ordered = lib.servers.slice().sort(function (a, b) {
        return b.prefix.length - a.prefix.length;
      });
      for (let i = 0; i < ordered.length; i++) {
        const srv = ordered[i];
        if (pathname.indexOf(srv.prefix) === 0) {
          return server(srv, req, res, pathname.slice(srv.prefix.length) || '/', query);
        }
      }
      return false;
    }
  };
}

module.exports = { create: create, DEVICES: DEVICES };
