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

  var played = null;             // 'serverId:ratingKey' -> 'serverId:deviceID'
  var claimed = null;            // null = never configured, so don't filter
  var list = [], idx = 0;
  var onClose = null;

  var elList = document.getElementById('device-list');

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* full */ } }

  function init() {
    var raw = lsGet('myDevices');
    if (!raw) return;
    try { claimed = JSON.parse(raw); } catch (e) { claimed = null; }
  }

  function itemKey(server, ratingKey) { return server.id + ':' + ratingKey; }

  /* One history fetch per server per session gives us "which device last played
     this". onDeck carries no device information of its own, so this is the only
     way to tell your viewing from the other TV's. */
  function ensureHistory() {
    if (played) return Promise.resolve(played);
    var servers = Servers.all();
    return Promise.all(servers.map(function (sv) {
      return Plex.history(sv, 200).then(function (entries) {
        return { server: sv, entries: entries };
      });
    })).then(function (perServer) {
      var map = {}, count = 0;
      perServer.forEach(function (res) {
        /* Sorted newest first, so the first entry per item is the latest. */
        res.entries.forEach(function (e) {
          if (!e.ratingKey || e.deviceID === undefined) return;
          var k = itemKey(res.server, e.ratingKey);
          if (map[k] === undefined) { map[k] = res.server.id + ':' + e.deviceID; count++; }
        });
      });
      played = map;
      UI.debug('history: ' + count + ' items across ' + servers.length + ' server' +
               (servers.length === 1 ? '' : 's') + ', ' + countDevices(map) + ' devices');
      return map;
    }).catch(function (e) {
      UI.debug('history unavailable: ' + e.message);
      played = {};                 // don't retry all session; filtering just stays off
      return played;
    });
  }

  function countDevices(map) {
    var seen = {}, keys = Object.keys(map), i;
    for (i = 0; i < keys.length; i++) seen[map[keys[i]]] = true;
    return Object.keys(seen).length;
  }

  /* A merged entry survives if any copy of it does. */
  function mine(items) {
    if (!claimed || !played) return items;
    return items.filter(function (entry) {
      var copies = Merge.sources(entry), i, dev;
      for (i = 0; i < copies.length; i++) {
        dev = played[(copies[i]._server || '') + ':' + copies[i].ratingKey];
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
    var servers = Servers.all();
    Promise.all([
      ensureHistory(),
      Promise.all(servers.map(function (sv) {
        return Plex.devices(sv).then(function (d) { return { server: sv, devices: d }; });
      }))
    ]).then(function (res) {
      var map = res[0] || {}, named = res[1] || [];
      var names = {}, counts = {}, keys = Object.keys(map), i;
      named.forEach(function (n) {
        n.devices.forEach(function (d) { names[n.server.id + ':' + d.id] = d.name; });
      });
      for (i = 0; i < keys.length; i++) {
        counts[map[keys[i]]] = (counts[map[keys[i]]] || 0) + 1;
      }
      list = Object.keys(counts).map(function (k) {
        var server = Servers.get(k.split(':')[0]);
        return { key: k, name: names[k] || ('device ' + k.split(':')[1]),
                 server: Servers.label(server), count: counts[k],
                 mine: claimed ? !!claimed[k] : true };
      }).sort(function (a, b) { return b.count - a.count; });
      render();
    });
  }

  function render() {
    if (!list.length) {
      elList.innerHTML =
        '<div class="device-row">No device history available on these servers.</div>';
      return;
    }
    var html = '', i, d;
    for (i = 0; i < list.length; i++) {
      d = list[i];
      html += '<div class="device-row' + (i === idx ? ' on' : '') + '">' +
              (d.mine ? '[x] ' : '[ ] ') + UI.escapeHtml(d.name) +
              (d.server ? ' <span class="device-count">on ' + UI.escapeHtml(d.server) +
                          '</span>' : '') +
              ' <span class="device-count">' + d.count + ' items</span></div>';
    }
    elList.innerHTML = html;
  }

  function save() {
    var changed = false;
    if (list.length) {
      var map = {}, i;
      for (i = 0; i < list.length; i++) if (list[i].mine) map[list[i].key] = true;
      claimed = map;
      lsSet('myDevices', JSON.stringify(map));
      UI.debug('devices: ' + Object.keys(map).length + ' of ' + list.length + ' claimed');
      changed = true;
    }
    var done = onClose;
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
