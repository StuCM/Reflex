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
  const CHANNEL_KEY = 'youtube:channel:' + HANDLE;

  const SEASON = /\b(?:season|series|s)\s*0*(\d{1,2})\b/i;

  /* Is there a key at all? Without one the recaps action never appears. */
  function enabled() { return !!KEY; }

  function request(path, params) {
    params.key = KEY;
    return Http.request(API + path + '?' + Http.qs(params), { label: 'YouTube ' + path });
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
    return Store.get(CHANNEL_KEY).then(function (cached) {
      if (cached) return cached;
      return get('/channels', { part: 'id', forHandle: HANDLE }).then(function (r) {
        const items = r && r.items;
        if (!items || !items.length || !items[0].id) {
          throw new Error('no channel for ' + HANDLE);
        }
        Store.put(CHANNEL_KEY, items[0].id);
        return items[0].id;
      });
    });
  }

  /* This show's recaps from that channel, raw. 100 units a press, so only ever
     called from a keypress; a quota refusal answers with nothing rather than an
     error, because "none today" is the truth the screen has to show. */
  function recaps(showTitle) {
    return channelId().then(function (id) {
      return get('/search', {
        part: 'snippet', channelId: id, q: showTitle + ' recap',
        maxResults: 25, type: 'video'
      });
    }).then(function (r) {
      return withLengths((r && r.items) || []);
    }).catch(function (e) {
      if (!/-> 403$/.test(e.message)) throw e;
      UI.debug('youtube: ' + e.message + ' (quota)');
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
    return get('/videos', { part: 'contentDetails', id: ids.join(',') }).then(function (r) {
      const by = {};
      let k;
      const list = (r && r.items) || [];
      for (k = 0; k < list.length; k++) by[list[k].id] = list[k].contentDetails;
      for (k = 0; k < items.length; k++) {
        id = items[k].id && items[k].id.videoId;
        if (by[id]) items[k].contentDetails = by[id];
      }
      return items;
    }, function () { return items; });
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
    order.sort(function (a, b) {
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
    return ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '') + ' ';
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

if (typeof module !== 'undefined') module.exports = Youtube;   // for the unit tests
