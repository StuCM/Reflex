/* Plex API. Chromium 53: Promises with .then(), no async/await, no object
   spread, no Object.entries.

   Every call that touches a media server takes that server as its first
   argument — see js/servers.js. There is deliberately no "current server"
   here: the account has more than one, the same film is on both, and the app
   has to be able to ask each of them separately. */
var Plex = (function () {
  'use strict';

  var TV       = Config.plexTvBase;
  var PRODUCT  = 'Reflex';
  var VERSION  = '0.0.1';
  var PLATFORM = 'webOS';
  var DEVICE   = 'LG OLED B8';

  /* Direct play profile we declare to the server. The server has no built-in
     profile for an unknown product, so without this it falls back to something
     conservative and transcodes. Do NOT widen this without confirming the B8
     panel actually decodes it — see CLAUDE.md. probe.py exists to test rows
     against a real file before they land here. */
  /* Items per category row. The rail shows ten across and you have to scroll to
     reach the rest, so asking for thirty per hub per server was mostly payload
     we never drew — and it is on the critical path of the first paint. */
  var HUB_COUNT = 12;

  var PROFILE = [
    'add-direct-play-profile(type=videoProfile&container=mkv&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)',
    'add-direct-play-profile(type=videoProfile&container=mp4&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)',
    'add-direct-play-profile(type=videoProfile&container=mpegts&codec=h264&audioCodec=aac,ac3,eac3,mp3)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&isRequired=false)',
    'add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10&isRequired=false)'
  ].join('+');

  /* Two kinds of token, and they are not interchangeable. The account token is
     for plex.tv. Each server hands out its own access token via
     /api/v2/resources — a server you do NOT own rejects the account token with
     401, which is the case here (shared user). Server tokens live on the server
     objects in js/servers.js. */
  var s = { clientId: null, token: null };

  /* ---------- plumbing ---------- */

  function ls(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* private mode / quota */ }
    return null;
  }

  function uuid() {
    var out = '', i;
    for (i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
      out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  function qs(params) {
    var keys = Object.keys(params), parts = [], i, v;
    for (i = 0; i < keys.length; i++) {
      v = params[keys[i]];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
    }
    return parts.join('&');
  }

  function headers() {
    return {
      'Accept': 'application/json',
      'X-Plex-Product': PRODUCT,
      'X-Plex-Version': VERSION,
      'X-Plex-Client-Identifier': s.clientId,
      'X-Plex-Platform': PLATFORM,
      'X-Plex-Platform-Version': '4.0',
      'X-Plex-Device': DEVICE,
      'X-Plex-Device-Name': 'Reflex (B8)',
      'X-Plex-Model': 'OLED55B8',
      'X-Plex-Device-Screen-Resolution': '1920x1080,3840x2160'
    };
  }

  /* opts.token: the token to send, or false for none. */
  function request(method, url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = opts.timeout || 15000;
      var h = headers(), keys = Object.keys(h), i;
      for (i = 0; i < keys.length; i++) xhr.setRequestHeader(keys[i], h[keys[i]]);
      if (opts.token) xhr.setRequestHeader('X-Plex-Token', opts.token);
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(method + ' ' + tidy(url) + ' -> ' + xhr.status + why(xhr)));
          return;
        }
        if (!xhr.responseText) { resolve(null); return; }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { resolve(xhr.responseText); }
      };
      xhr.ontimeout = function () { reject(new Error('timeout ' + url)); };
      xhr.onerror = function () { reject(new Error('network ' + url)); };
      xhr.send(opts.body || null);
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
    var body = '';
    try { body = xhr.responseText || ''; } catch (e) { return ''; }
    if (!body) return '';
    var m = body.match(/status="([^"]+)"/) ||        // <Response status="..."/>
            body.match(/"status"\s*:\s*"([^"]+)"/);
    if (m) return '  ·  ' + m[1];
    return '  ·  ' + body.replace(/\s+/g, ' ').substring(0, 220);
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

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Resolves with a token once the user has entered the code, or null if the
     pin expired. A failed poll is reported and retried rather than thrown — a
     single network blip must not throw the user back to a fresh code. */
  function linkPoll(pinId, deadline, onStatus) {
    var tries = 0;

    function attempt() {
      tries++;
      return tv('GET', '/api/v2/pins/' + pinId, { token: false })
        .then(function (pin) {
          if (pin && pin.authToken) {
            s.token = pin.authToken;
            ls('token', s.token);
            if (onStatus) onStatus('linked, token stored');
            return s.token;
          }
          if (onStatus) onStatus('pin ' + pinId + ' · poll ' + tries + ' · not claimed yet');
          if (Date.now() > deadline) return null;
          return wait(2000).then(attempt);
        }, function (err) {
          if (onStatus) onStatus('pin ' + pinId + ' · poll ' + tries + ' FAILED: ' + err.message);
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
      .then(function () { return uri; });
  }

  /* Promise.any doesn't exist in Chromium 53. */
  function raceOk(promises) {
    return new Promise(function (resolve, reject) {
      var left = promises.length, settled = false;
      if (!left) { reject(new Error('nothing to race')); return; }
      promises.forEach(function (p) {
        p.then(function (v) {
          if (!settled) { settled = true; resolve(v); }
        }, function () {
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
    var cached = Servers.all();
    if (cached.length) {
      return Promise.all(cached.map(function (sv) {
        return ping(sv.base, sv.token).then(function () { return sv; }, function () { return null; });
      })).then(function (live) {
        var ok = live.filter(function (sv) { return !!sv; });
        if (ok.length) { Servers.set(ok); return ok; }
        Servers.forget();
        return discover();
      });
    }

    return tv('GET', '/api/v2/resources?' + qs({ includeHttps: 1, includeRelay: 0 }))
      .then(function (resources) {
        var jobs = [], i, r;
        for (i = 0; i < resources.length; i++) {
          r = resources[i];
          if (!r.provides || r.provides.indexOf('server') < 0) continue;
          jobs.push(reach(r));
        }
        if (!jobs.length) throw new Error('no servers on this account');
        return Promise.all(jobs);
      })
      .then(function (found) {
        var ok = found.filter(function (sv) { return !!sv; });
        if (!ok.length) throw new Error('no direct server connection');
        /* Stable order, so rows do not reshuffle between launches. */
        ok.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
        Servers.set(ok);
        return ok;
      });
  }

  function reach(resource) {
    var token = resource.accessToken || s.token;
    var uris = [], j, c;
    for (j = 0; j < (resource.connections || []).length; j++) {
      c = resource.connections[j];
      if (c.relay) continue;
      uris.push(c.uri);
    }
    if (!uris.length) return Promise.resolve(null);
    return raceOk(uris.map(function (u) { return ping(u, token); })).then(function (uri) {
      return { id: resource.clientIdentifier, name: resource.name || 'server',
               base: uri, token: token };
    }, function () { return null; });
  }

  /* ---------- library ---------- */

  function sections(server) {
    return ask(server, '/library/sections').then(function (res) {
      var dirs = (res.MediaContainer && res.MediaContainer.Directory) || [], out = [], i;
      for (i = 0; i < dirs.length; i++) {
        if (dirs[i].type !== 'movie') continue;   // shows: task 3
        /* updatedAt is what lets us skip re-crawling an unchanged section. */
        out.push({ key: dirs[i].key, title: dirs[i].title, type: dirs[i].type,
                   updatedAt: dirs[i].updatedAt || 0, server: server.id });
      }
      return out;
    }).catch(function () { return []; });
  }

  function items(server, sectionKey, start, size, extra) {
    var params = {
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
      var keys = Object.keys(extra), i;
      for (i = 0; i < keys.length; i++) params[keys[i]] = extra[keys[i]];
    }
    return ask(server, '/library/sections/' + sectionKey + '/all?' + qs(params),
               { timeout: 20000 }).then(function (res) {
      var mc = res.MediaContainer || {};
      return { total: mc.totalSize || mc.size || 0,
               items: Servers.stamp(mc.Metadata || [], server) };
    });
  }

  /* Which certificates this library actually uses. Asking beats hardcoding —
     the server may label things BBFC (U, PG, 12A, 15, 18) or MPAA (G, PG-13,
     R), or prefix them by region ("gb/12A"). */
  function contentRatings(server, sectionKey) {
    return ask(server, '/library/sections/' + sectionKey + '/contentRating')
      .then(function (res) {
        var dirs = (res.MediaContainer && res.MediaContainer.Directory) || [], out = [], i;
        for (i = 0; i < dirs.length; i++) out.push(dirs[i].title || dirs[i].key);
        return out;
      }).catch(function () { return []; });
  }

  /* Continue Watching. /library/onDeck is the universally supported endpoint —
     /hubs/continueWatching only exists on newer servers. One request. */
  function onDeck(server) {
    return ask(server, '/library/onDeck').then(function (res) {
      var md = (res.MediaContainer && res.MediaContainer.Metadata) || [];
      return Servers.stamp(md.filter(function (m) { return m.type === 'movie'; }), server);
    }).catch(function () { return []; });
  }

  /* The section's own categories — Recently Added, Recently Released and so on.
     One request returns every hub with its items, which is how the stock app
     shows a huge library without listing it. */
  function hubs(server, sectionKey) {
    return ask(server, '/hubs/sections/' + sectionKey + '?' + qs({ count: HUB_COUNT }),
               { timeout: 20000 }).then(function (res) {
      var list = (res.MediaContainer && res.MediaContainer.Hub) || [], out = [], i, h;
      for (i = 0; i < list.length; i++) {
        h = list[i];
        if (h.type !== 'movie' || !h.Metadata || !h.Metadata.length) continue;
        out.push({ title: h.title, items: Servers.stamp(h.Metadata, server) });
      }
      return out;
    }).catch(function () { return []; });
  }

  /* ponytail: movies only, because show drill-down doesn't exist yet (task 3).
     Widen the type filter when it does. */
  function search(server, query) {
    return ask(server, '/hubs/search?' + qs({ query: query, limit: 40 }), { timeout: 20000 })
      .then(function (res) {
        var list = (res.MediaContainer && res.MediaContainer.Hub) || [], out = [], i, j, h;
        for (i = 0; i < list.length; i++) {
          h = list[i];
          if (h.type !== 'movie' || !h.Metadata) continue;
          for (j = 0; j < h.Metadata.length; j++) {
            if (h.Metadata[j].type === 'movie') out.push(h.Metadata[j]);
          }
        }
        return Servers.stamp(out, server);
      }).catch(function () { return []; });
  }

  /* Watch history. Plex attributes everything to the account, not the person,
     but each entry records which device played it — which is the only handle we
     have on "that was the other TV, not me". */
  function history(server, size) {
    return ask(server, '/status/sessions/history/all?' + qs({
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': size || 200
    }), { timeout: 20000 }).then(function (res) {
      return (res.MediaContainer && res.MediaContainer.Metadata) || [];
    }).catch(function () { return []; });
  }

  function devices(server) {
    return ask(server, '/devices').then(function (res) {
      var d = (res.MediaContainer && res.MediaContainer.Device) || [], out = [], i;
      for (i = 0; i < d.length; i++) {
        out.push({ id: String(d[i].id),
                   name: d[i].name || d[i].clientIdentifier || ('device ' + d[i].id),
                   platform: d[i].platform || '' });
      }
      return out;
    }).catch(function () { return []; });
  }

  /* Find a library item by external id, e.g. 'tmdb://27205'. This is the join
     that lets us start from a curated external list and ask what the server
     has, instead of crawling the library. */
  function findByGuid(server, guid) {
    return ask(server, '/library/all?' + qs({ guid: guid, includeGuids: 1 }), { timeout: 15000 })
      .then(function (res) {
        var m = (res.MediaContainer && res.MediaContainer.Metadata) || [];
        return m.length ? Servers.stamp(m, server)[0] : null;
      }).catch(function () { return null; });
  }

  /* TMDB id off an item, handling both the modern Guid array and the legacy
     agent form (com.plexapp.agents.themoviedb://123?lang=en). */
  function tmdbId(item) {
    var g = (item && item.Guid) || [], i, id;
    for (i = 0; i < g.length; i++) {
      id = g[i].id || '';
      if (id.indexOf('tmdb://') === 0) return id.substring(7);
    }
    var m = String((item && item.guid) || '').match(/themoviedb:\/\/(\d+)/);
    return m ? m[1] : null;
  }

  function metadata(server, ratingKey) {
    return ask(server, '/library/metadata/' + ratingKey + '?' +
               qs({ includeGuids: 1, includeExtras: 1 })).then(function (res) {
      var m = res.MediaContainer && res.MediaContainer.Metadata;
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

  /* ---------- playback decision ---------- */

  var sessionId = null;
  function session() {
    if (!sessionId) sessionId = uuid();
    return sessionId;
  }

  /* hasMDE=1 returns the verdict WITHOUT opening a session, so this is safe to
     call on a server we don't own. Never call the non-decision transcode
     endpoints. */
  function decide(server, item, mediaIndex, partIndex, audioStreamId) {
    var url = '/video/:/transcode/universal/decision?' + qs({
      hasMDE: 1,
      path: '/library/metadata/' + item.ratingKey,
      mediaIndex: mediaIndex,
      partIndex: partIndex,
      protocol: 'http',
      directPlay: 1,
      directStream: 1,
      directStreamAudio: 1,
      fastSeek: 1,
      subtitles: 'none',
      audioBoost: 100,
      autoAdjustQuality: 0,
      mediaBufferSize: 102400,
      /* ponytail: we connect directly, not via relay, so 'lan' is what keeps
         the server's remote-quality cap out of the decision. probe.py varies
         this — if a row shows 'wan' also direct plays, prefer honesty. */
      location: 'lan',
      session: session(),
      audioStreamID: audioStreamId || null,
      'X-Plex-Client-Profile-Extra': PROFILE
    });
    return ask(server, url, { timeout: 20000 }).then(function (res) {
      var mc = res.MediaContainer || {};
      var md = (mc.Metadata && mc.Metadata[0]) || null;
      var part = md && md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
      return {
        decision: (part && part.decision) || 'unknown',
        text: mc.transcodeDecisionText || mc.generalDecisionText || mc.mdeDecisionText || '',
        raw: mc
      };
    });
  }

  function streamUrl(server, part) {
    return server.base + part.key + '?' + qs({ 'X-Plex-Token': server.token });
  }

  /* ---------- progress ---------- */

  /* Reported to the server we are playing from. Plex syncs the position to the
     account, which is why the same film picked up on the other server resumes
     in the right place. */
  function timeline(server, item, state, timeMs, durationMs) {
    return ask(server, '/:/timeline?' + qs({
      ratingKey: item.ratingKey,
      key: '/library/metadata/' + item.ratingKey,
      state: state,
      time: Math.floor(timeMs),
      duration: Math.floor(durationMs),
      playbackTime: Math.floor(timeMs),
      hasMDE: 1
    }), { timeout: 8000 }).catch(function () { return null; });
  }

  return {
    init: init, hasToken: hasToken, signOut: signOut,
    linkStart: linkStart, linkPoll: linkPoll, forgetServers: forgetServers,
    discover: discover, state: s,
    sections: sections, items: items, metadata: metadata,
    posterUrl: posterUrl, artUrl: artUrl, photoUrl: photoUrl,
    onDeck: onDeck, hubs: hubs, search: search,
    history: history, devices: devices, findByGuid: findByGuid, tmdbId: tmdbId,
    contentRatings: contentRatings,
    decide: decide, streamUrl: streamUrl, timeline: timeline
  };
})();
