/* A fake plex.tv and a fake Plex Media Server, good enough to run the whole
   app against. Runs on Node only — the Chromium 53 constraint does not apply.

   Everything the app calls is here, and nothing else is. If the app starts
   calling a new endpoint, this file is where you find out, because the mock
   answers 404 and says so on the console.

   Two prefixes:
     /__plextv/...   stands in for https://plex.tv   (Config.plexTvBase)
     /__plex/...     stands in for the media server  (handed out by discovery) */
'use strict';

const fs = require('fs');
const path = require('path');
const buildLibrary = require('./library').build;

const TOKEN = 'mock-account-token';
const SERVER_TOKEN = 'mock-server-token';
const MACHINE_ID = 'mockmachine0000000000000000000000000001';

/* Three devices in the history. Two are "ours", the third is there so the
   device claim screen has something to exclude. */
const DEVICES = [
  { id: '1', name: 'Living room (B8)', platform: 'webOS' },
  { id: '2', name: 'iPhone', platform: 'iOS' },
  { id: '3', name: "Attic Fire TV", platform: 'Android' }
];

function create(opts) {
  const log = opts.log || function () {};
  const lib = buildLibrary({ films: opts.films, uhd: opts.uhd });
  const pins = {};
  let nextPin = 4000;

  /* Continue Watching: a handful part-played, spread across the devices so the
     "whose viewing is this" screen has real data to show. */
  const deck = [];
  const history = [];
  Object.keys(lib.items).forEach(function (key) {
    const list = lib.items[key];
    for (let i = 0; i < list.length && deck.length < 9; i += Math.max(1, Math.floor(list.length / 5))) {
      const m = JSON.parse(JSON.stringify(list[i]));
      m.viewOffset = Math.floor(m.duration * (0.1 + (i % 7) / 10));
      m.lastViewedAt = 1720000000 + i;
      deck.push(m);
    }
  });
  deck.forEach(function (m, i) {
    history.push({
      ratingKey: m.ratingKey,
      title: m.title,
      type: 'movie',
      viewedAt: 1720000000 - i * 3600,
      deviceID: Number(DEVICES[i % DEVICES.length].id),
      accountID: 1
    });
  });
  /* Some plain history with no matching deck entry, so the device counts are
     not all 1. */
  Object.keys(lib.byKey).slice(0, 60).forEach(function (k, i) {
    history.push({
      ratingKey: k, title: lib.byKey[k].title, type: 'movie',
      viewedAt: 1719000000 - i * 3600,
      deviceID: Number(DEVICES[i % DEVICES.length].id), accountID: 1
    });
  });
  history.sort(function (a, b) { return b.viewedAt - a.viewedAt; });

  function container(fields) {
    const mc = { size: 0, identifier: 'com.plexapp.plugins.library' };
    Object.keys(fields || {}).forEach(function (k) { mc[k] = fields[k]; });
    return { MediaContainer: mc };
  }

  function slice(list, q) {
    const start = Number(q['X-Plex-Container-Start'] || 0);
    const sizeRaw = q['X-Plex-Container-Size'];
    const size = sizeRaw === undefined ? list.length : Number(sizeRaw);
    return { total: list.length, page: list.slice(start, start + size) };
  }

  function filtered(sectionKey, q) {
    let list = lib.items[sectionKey] || [];
    /* Only the filters the app actually sends. contentRating arrives as a
       comma-separated list, applied server side — see Plex.items. */
    if (q.contentRating) {
      const allow = {};
      String(q.contentRating).split(',').forEach(function (r) { allow[r] = true; });
      list = list.filter(function (m) { return m.contentRating && allow[m.contentRating]; });
    }
    return list;
  }

  /* ---------- poster ---------- */

  function poster(res, q) {
    const m = String(q.url || '').match(/\/library\/metadata\/(\d+)\//);
    const item = m ? lib.byKey[m[1]] : null;
    const w = Number(q.width || 160), h = Number(q.height || 240);
    const hue = item ? (Number(item.ratingKey) * 37) % 360 : 210;
    const title = item ? item.title : '?';
    const year = item ? item.year : '';
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

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" ' +
      'viewBox="0 0 160 240">' +
      '<rect width="160" height="240" fill="hsl(' + hue + ',34%,26%)"/>' +
      '<rect y="196" width="160" height="44" fill="rgba(0,0,0,0.35)"/>' +
      text +
      '<text x="12" y="224" font-family="Helvetica,Arial" font-size="18" ' +
      'fill="rgba(255,255,255,0.6)">' + year + '</text>' +
      '</svg>';
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=60' });
    res.end(svg);
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- the decision endpoint ---------- */

  /* The rule the real server enforces, near enough: it will happily direct play
     anything our declared profile covers, and it will transcode when asked for
     something the profile does not list. Getting this wrong in the app is what
     lands a transcode on someone else's dashboard, so the mock is deliberately
     strict about it. */
  function decision(res, q) {
    const m = String(q.path || '').match(/\/library\/metadata\/(\d+)/);
    const item = m ? lib.byKey[m[1]] : null;
    if (!item) { json(res, 404, container({ size: 0 })); return; }

    const full = lib.fullMetadata(item);
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

    if (video.codec === 'vc1' || full.Media[0].container === 'avi') {
      verdict = 'transcode';
      text = 'Conversion required. Video: Unsupported codec (' + video.codec +
             '). Container: Unsupported container (' + full.Media[0].container + ').';
    } else if (audio && (audio.codec === 'truehd' ||
               (audio.codec === 'dca' && String(audio.profile || '').indexOf('ma') === 0))) {
      verdict = 'transcode';
      text = 'Conversion required. Audio: Unsupported codec (' + audio.codec + ').';
    }

    log('decision ' + item.title + ' audio=' + (audio ? audio.codec : 'none') +
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
     supply: drop any browser-playable file at dev/fixtures/sample.mp4 (or .webm)
     and every item plays it. Without one the player takes its error path, which
     is worth seeing at least once too. */
  function streamFile(req, res) {
    const dir = path.join(__dirname, 'fixtures');
    let file = null;
    ['sample.mp4', 'sample.webm', 'sample.mkv'].forEach(function (name) {
      if (!file && fs.existsSync(path.join(dir, name))) file = path.join(dir, name);
    });
    if (!file) {
      log('stream requested but dev/fixtures/sample.mp4 is missing — the player ' +
          'will show its media-error path');
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no dev/fixtures/sample.* — see README');
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

  /* ---------- routing ---------- */

  function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(text)
    });
    res.end(text);
  }

  function plexTv(req, res, pathname, q, origin) {
    if (pathname === '/api/v2/pins' && req.method === 'POST') {
      const id = nextPin++;
      const code = 'MOCK';
      pins[id] = { code: code, polls: 0 };
      log('pin ' + id + ' issued, code ' + code + ' (claims itself after ' +
          opts.pinPolls + ' polls)');
      json(res, 201, { id: id, code: code, authToken: null });
      return true;
    }
    const pin = pathname.match(/^\/api\/v2\/pins\/(\d+)$/);
    if (pin) {
      const p = pins[pin[1]];
      if (!p) { json(res, 404, {}); return true; }
      p.polls++;
      const claimed = p.polls > opts.pinPolls;
      json(res, 200, { id: Number(pin[1]), code: p.code, authToken: claimed ? TOKEN : null });
      return true;
    }
    if (pathname === '/api/v2/resources') {
      json(res, 200, [{
        name: 'Mock Server',
        product: 'Plex Media Server',
        clientIdentifier: MACHINE_ID,
        provides: 'server',
        owned: false,
        accessToken: SERVER_TOKEN,
        connections: [
          /* A dead one first, so discovery's race is doing something. */
          { uri: 'http://10.255.255.1:32400', local: true, relay: false, IPv6: false },
          { uri: origin + '/__plex', local: false, relay: false, IPv6: false },
          { uri: 'https://relay.example.invalid', local: false, relay: true, IPv6: false }
        ]
      }]);
      return true;
    }
    return false;
  }

  function server(req, res, pathname, q) {
    if (pathname === '/identity') {
      json(res, 200, container({ machineIdentifier: MACHINE_ID, version: '1.40.0.0-mock' }));
      return true;
    }

    if (pathname === '/library/sections') {
      json(res, 200, container({
        size: lib.sections.length,
        Directory: lib.sections.map(function (s) {
          return { key: s.key, title: s.title, type: s.type, updatedAt: s.updatedAt,
                   agent: 'tv.plex.agents.movie', scanner: 'Plex Movie' };
        })
      }));
      return true;
    }

    let m = pathname.match(/^\/library\/sections\/(\w+)\/all$/);
    if (m) {
      const list = filtered(m[1], q);
      const cut = slice(list, q);
      json(res, 200, container({
        size: cut.page.length, totalSize: cut.total, offset: Number(q['X-Plex-Container-Start'] || 0),
        Metadata: cut.page.map(stripStreams)
      }));
      return true;
    }

    m = pathname.match(/^\/library\/sections\/(\w+)\/contentRating$/);
    if (m) {
      const ratings = lib.contentRatings(m[1]);
      json(res, 200, container({
        size: ratings.length,
        Directory: ratings.map(function (r) { return { key: r, title: r }; })
      }));
      return true;
    }

    m = pathname.match(/^\/hubs\/sections\/(\w+)$/);
    if (m) {
      const list = lib.items[m[1]] || [];
      const byAdded = list.slice().sort(function (a, b) { return b.addedAt - a.addedAt; });
      const byYear = list.slice().sort(function (a, b) { return b.year - a.year; });
      const hubs = [
        { title: 'Recently Added', hubIdentifier: 'recentlyAdded', type: 'movie',
          Metadata: byAdded.slice(0, 20).map(stripStreams) },
        { title: 'Recently Released', hubIdentifier: 'newest', type: 'movie',
          Metadata: byYear.slice(0, 20).map(stripStreams) },
        { title: 'Top Rated', hubIdentifier: 'topRated', type: 'movie',
          Metadata: list.slice(30, 50).map(stripStreams) },
        /* A non-movie hub, to prove the app skips it. */
        { title: 'Directors', hubIdentifier: 'director', type: 'director', Metadata: [] }
      ];
      json(res, 200, container({ size: hubs.length, Hub: hubs }));
      return true;
    }

    if (pathname === '/library/onDeck') {
      json(res, 200, container({ size: deck.length, Metadata: deck.map(stripStreams) }));
      return true;
    }

    if (pathname === '/hubs/search') {
      const needle = String(q.query || '').toLowerCase();
      const hits = [];
      Object.keys(lib.items).forEach(function (k) {
        lib.items[k].forEach(function (item) {
          if (hits.length < Number(q.limit || 40) &&
              item.title.toLowerCase().indexOf(needle) >= 0) hits.push(item);
        });
      });
      json(res, 200, container({
        size: 1,
        Hub: [
          { title: 'Movies', type: 'movie', Metadata: hits.map(stripStreams) },
          { title: 'People', type: 'actor', Metadata: [] }
        ]
      }));
      return true;
    }

    if (pathname === '/status/sessions/history/all') {
      const cut = slice(history, q);
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
      const hit = lib.byTmdb[q.guid];
      json(res, 200, container({ size: hit ? 1 : 0, Metadata: hit ? [stripStreams(hit)] : [] }));
      return true;
    }

    m = pathname.match(/^\/library\/metadata\/(\d+)$/);
    if (m) {
      const item = lib.byKey[m[1]];
      if (!item) { json(res, 404, container({ size: 0 })); return true; }
      const deckHit = deck.filter(function (d) { return d.ratingKey === item.ratingKey; })[0];
      const full = lib.fullMetadata(item);
      if (deckHit) full.viewOffset = deckHit.viewOffset;
      json(res, 200, container({ size: 1, Metadata: [full] }));
      return true;
    }

    if (pathname === '/photo/:/transcode') { poster(res, q); return true; }

    if (pathname === '/video/:/transcode/universal/decision') { decision(res, q); return true; }

    if (pathname.indexOf('/library/parts/') === 0) { streamFile(req, res); return true; }

    if (pathname === '/:/timeline') {
      log('timeline ' + q.state + ' ' + Math.round(Number(q.time || 0) / 1000) + 's');
      json(res, 200, container({ size: 0 }));
      return true;
    }

    return false;
  }

  /* The list endpoints carry Media but not Stream, exactly like a real server —
     which is why the app has to fetch metadata to know the audio tracks. */
  function stripStreams(item) {
    const copy = JSON.parse(JSON.stringify(item));
    delete copy._profile;
    if (copy.Media && copy.Media[0] && copy.Media[0].Part) {
      copy.Media[0].Part.forEach(function (p) { delete p.Stream; });
    }
    return copy;
  }

  return {
    library: lib,
    token: TOKEN,
    serverToken: SERVER_TOKEN,
    /* Returns true if it answered. */
    handle: function (req, res, pathname, query, origin) {
      if (pathname.indexOf('/__plextv') === 0) {
        return plexTv(req, res, pathname.slice('/__plextv'.length) || '/', query, origin);
      }
      if (pathname.indexOf('/__plex') === 0) {
        return server(req, res, pathname.slice('/__plex'.length) || '/', query);
      }
      return false;
    }
  };
}

module.exports = { create: create, DEVICES: DEVICES };
