/* Plex API. Chromium 53: Promises with .then(), no async/await, no object
   spread, no Object.entries. */
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
  var PROFILE = [
    'add-direct-play-profile(type=videoProfile&container=mkv&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)',
    'add-direct-play-profile(type=videoProfile&container=mp4&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)',
    'add-direct-play-profile(type=videoProfile&container=mpegts&codec=h264&audioCodec=aac,ac3,eac3,mp3)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&isRequired=false)',
    'add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10&isRequired=false)'
  ].join('+');

  /* Two tokens, and they are not interchangeable. `token` is the plex.tv
     account token. `serverToken` is the per-server access token handed out by
     /api/v2/resources — a server you do NOT own rejects the account token with
     401, which is the case here (shared user). */
  var s = { clientId: null, token: null, serverToken: null,
            base: null, machineId: null, serverName: null };

  function serverToken() { return s.serverToken || s.token; }

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

  function request(method, url, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = opts.timeout || 15000;
      var h = headers(), keys = Object.keys(h), i;
      for (i = 0; i < keys.length; i++) xhr.setRequestHeader(keys[i], h[keys[i]]);
      if (opts.token !== false) {
        var tok = url.indexOf(TV) === 0 ? s.token : serverToken();
        if (tok) xhr.setRequestHeader('X-Plex-Token', tok);
      }
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(method + ' ' + url + ' -> ' + xhr.status));
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

  /* ---------- auth ---------- */

  function init() {
    s.clientId = ls('clientId');
    if (!s.clientId) { s.clientId = uuid(); ls('clientId', s.clientId); }
    s.token = ls('token');
    s.serverToken = ls('serverToken');
    s.base = ls('base');
    s.machineId = ls('machineId');
    s.serverName = ls('serverName');
  }

  function hasToken() { return !!s.token; }

  /* No strong=true — that returns a long PIN for the auth-URL flow. plex.tv/link
     only accepts the plain 4-character code. */
  function linkStart() {
    return request('POST', TV + '/api/v2/pins', { token: false });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Resolves with a token once the user has entered the code, or null if the
     pin expired. A failed poll is reported and retried rather than thrown — a
     single network blip must not throw the user back to a fresh code. */
  function linkPoll(pinId, deadline, onStatus) {
    var tries = 0;

    function attempt() {
      tries++;
      return request('GET', TV + '/api/v2/pins/' + pinId, { token: false })
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

  /* A 401 from the media server says nothing about the plex.tv login — drop the
     server details and rediscover rather than making the user link again. */
  function forgetServer() {
    s.serverToken = null; s.base = null; s.machineId = null;
    ls('serverToken', null); ls('base', null); ls('machineId', null);
  }

  function signOut() {
    s.token = null; s.serverToken = null; s.base = null; s.machineId = null;
    ls('token', null); ls('serverToken', null); ls('base', null);
    ls('machineId', null); ls('serverName', null);
  }

  /* ---------- server discovery ---------- */

  function ping(uri) {
    return request('GET', uri + '/identity', { timeout: 4000 }).then(function () { return uri; });
  }

  /* Races every non-relay connection of every shared server. First to answer
     wins — that is the fastest path to the user's shared server, and we never
     open a relay (CLAUDE.md: direct connections only). */
  function discover() {
    /* No serverToken means a cache from before we knew to keep one — rediscover
       rather than retry the account token and get another 401. */
    if (s.base && s.serverToken) {
      return ping(s.base).then(function () { return s; }, function () { s.base = null; return discover(); });
    }
    s.base = null;
    return request('GET', TV + '/api/v2/resources?' + qs({ includeHttps: 1, includeRelay: 0 }))
      .then(function (resources) {
        var candidates = [], i, j, r, c;
        for (i = 0; i < resources.length; i++) {
          r = resources[i];
          if (!r.provides || r.provides.indexOf('server') < 0) continue;
          for (j = 0; j < (r.connections || []).length; j++) {
            c = r.connections[j];
            if (c.relay) continue;
            candidates.push({ uri: c.uri, server: r });
          }
        }
        if (!candidates.length) throw new Error('no direct server connection');
        return raceOk(candidates.map(function (cand) {
          return ping(cand.uri).then(function () { return cand; });
        }));
      })
      .then(function (winner) {
        s.base = winner.uri;
        s.machineId = winner.server.clientIdentifier;
        s.serverName = winner.server.name;
        s.serverToken = winner.server.accessToken || s.token;
        ls('base', s.base); ls('machineId', s.machineId); ls('serverName', s.serverName);
        ls('serverToken', s.serverToken);
        return s;
      });
  }

  /* Promise.any doesn't exist in Chromium 53. */
  function raceOk(promises) {
    return new Promise(function (resolve, reject) {
      var left = promises.length, settled = false;
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

  /* ---------- library ---------- */

  function sections() {
    return request('GET', s.base + '/library/sections').then(function (res) {
      var dirs = (res.MediaContainer && res.MediaContainer.Directory) || [], out = [], i;
      for (i = 0; i < dirs.length; i++) {
        if (dirs[i].type !== 'movie') continue;   // shows: task 3
        /* updatedAt is what lets us skip re-crawling an unchanged section. */
        out.push({ key: dirs[i].key, title: dirs[i].title, type: dirs[i].type,
                   updatedAt: dirs[i].updatedAt || 0 });
      }
      return out;
    });
  }

  function items(sectionKey, start, size, extra) {
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
    var url = s.base + '/library/sections/' + sectionKey + '/all?' + qs(params);
    return request('GET', url, { timeout: 20000 }).then(function (res) {
      var mc = res.MediaContainer || {};
      return { total: mc.totalSize || mc.size || 0, items: mc.Metadata || [] };
    });
  }

  /* Which certificates this library actually uses. Asking beats hardcoding —
     the server may label things BBFC (U, PG, 12A, 15, 18) or MPAA (G, PG-13,
     R), or prefix them by region ("gb/12A"). */
  function contentRatings(sectionKey) {
    return request('GET', s.base + '/library/sections/' + sectionKey + '/contentRating')
      .then(function (res) {
        var dirs = (res.MediaContainer && res.MediaContainer.Directory) || [], out = [], i;
        for (i = 0; i < dirs.length; i++) out.push(dirs[i].title || dirs[i].key);
        return out;
      }).catch(function () { return []; });
  }

  /* Continue Watching. /library/onDeck is the universally supported endpoint —
     /hubs/continueWatching only exists on newer servers. One request. */
  function onDeck() {
    return request('GET', s.base + '/library/onDeck').then(function (res) {
      var md = (res.MediaContainer && res.MediaContainer.Metadata) || [];
      return md.filter(function (m) { return m.type === 'movie'; });
    }).catch(function () { return []; });
  }

  /* The section's own categories — Recently Added, Recently Released and so on.
     One request returns every hub with its items, which is how the stock app
     shows a huge library without listing it. */
  function hubs(sectionKey) {
    var url = s.base + '/hubs/sections/' + sectionKey + '?' + qs({ count: 30 });
    return request('GET', url, { timeout: 20000 }).then(function (res) {
      var list = (res.MediaContainer && res.MediaContainer.Hub) || [], out = [], i, h;
      for (i = 0; i < list.length; i++) {
        h = list[i];
        if (h.type !== 'movie' || !h.Metadata || !h.Metadata.length) continue;
        out.push({ title: h.title, items: h.Metadata });
      }
      return out;
    }).catch(function () { return []; });
  }

  /* ponytail: movies only, because show drill-down doesn't exist yet (task 3).
     Widen the type filter when it does. */
  function search(query) {
    var url = s.base + '/hubs/search?' + qs({ query: query, limit: 40 });
    return request('GET', url, { timeout: 20000 }).then(function (res) {
      var list = (res.MediaContainer && res.MediaContainer.Hub) || [], out = [], i, j, h;
      for (i = 0; i < list.length; i++) {
        h = list[i];
        if (h.type !== 'movie' || !h.Metadata) continue;
        for (j = 0; j < h.Metadata.length; j++) {
          if (h.Metadata[j].type === 'movie') out.push(h.Metadata[j]);
        }
      }
      return out;
    });
  }

  /* Watch history. Plex attributes everything to the account, not the person,
     but each entry records which device played it — which is the only handle we
     have on "that was the other TV, not me". */
  function history(size) {
    var url = s.base + '/status/sessions/history/all?' + qs({
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': size || 200
    });
    return request('GET', url, { timeout: 20000 }).then(function (res) {
      return (res.MediaContainer && res.MediaContainer.Metadata) || [];
    });
  }

  function devices() {
    return request('GET', s.base + '/devices').then(function (res) {
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
  function findByGuid(guid) {
    return request('GET', s.base + '/library/all?' + qs({ guid: guid, includeGuids: 1 }),
                   { timeout: 15000 })
      .then(function (res) {
        var m = (res.MediaContainer && res.MediaContainer.Metadata) || [];
        return m.length ? m[0] : null;
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

  function metadata(ratingKey) {
    return request('GET', s.base + '/library/metadata/' + ratingKey + '?' +
                   qs({ includeGuids: 1 })).then(function (res) {
      var m = res.MediaContainer && res.MediaContainer.Metadata;
      return (m && m[0]) || null;
    });
  }

  function posterUrl(item, w, h) {
    if (!item.thumb) return '';
    return s.base + '/photo/:/transcode?' + qs({
      width: w, height: h, minSize: 1, upscale: 1,
      url: item.thumb + '?X-Plex-Token=' + serverToken(),
      'X-Plex-Token': serverToken()
    });
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
  function decide(item, mediaIndex, partIndex, audioStreamId) {
    var url = s.base + '/video/:/transcode/universal/decision?' + qs({
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
    return request('GET', url, { timeout: 20000 }).then(function (res) {
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

  function streamUrl(part) {
    return s.base + part.key + '?' + qs({ 'X-Plex-Token': serverToken() });
  }

  /* ---------- progress ---------- */

  function timeline(item, state, timeMs, durationMs) {
    var url = s.base + '/:/timeline?' + qs({
      ratingKey: item.ratingKey,
      key: '/library/metadata/' + item.ratingKey,
      state: state,
      time: Math.floor(timeMs),
      duration: Math.floor(durationMs),
      playbackTime: Math.floor(timeMs),
      hasMDE: 1
    });
    return request('GET', url, { timeout: 8000 }).catch(function () { return null; });
  }

  return {
    init: init, hasToken: hasToken, signOut: signOut,
    linkStart: linkStart, linkPoll: linkPoll, forgetServer: forgetServer,
    discover: discover, state: s,
    sections: sections, items: items, metadata: metadata, posterUrl: posterUrl,
    onDeck: onDeck, hubs: hubs, search: search,
    history: history, devices: devices, findByGuid: findByGuid, tmdbId: tmdbId,
    contentRatings: contentRatings,
    decide: decide, streamUrl: streamUrl, timeline: timeline
  };
})();
