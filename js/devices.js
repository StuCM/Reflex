/* Whose viewing is this?

   Plex attributes everything to the account, not the person. On a shared
   account that means someone else's half-watched films sit in Continue
   watching, which makes the row useless. Each history entry does record the
   device that played it, so: ask once which devices are yours, then drop deck
   items last played on one that is not.

   Unknown provenance is kept. Better a stray entry than silently hiding your
   own viewing. */
var Devices = (function () {
  'use strict';

  var deviceMap = null;          // ratingKey -> deviceID of the most recent play
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

  /* One history fetch per session gives us ratingKey -> which device last
     played it. onDeck carries no device information of its own, so this is the
     only way to tell your viewing from the other TV's. */
  function ensureHistory() {
    if (deviceMap) return Promise.resolve(deviceMap);
    return Plex.history(200).then(function (entries) {
      var map = {}, i, e;
      /* Sorted newest first, so the first entry per ratingKey is the latest. */
      for (i = 0; i < entries.length; i++) {
        e = entries[i];
        if (!e.ratingKey || e.deviceID === undefined) continue;
        if (map[e.ratingKey] === undefined) map[e.ratingKey] = String(e.deviceID);
      }
      deviceMap = map;
      UI.debug('history: ' + entries.length + ' entries, ' +
               Object.keys(map).length + ' items, ' + countDevices(map) + ' devices');
      return map;
    }).catch(function (e) {
      UI.debug('history unavailable: ' + e.message);
      deviceMap = {};                 // don't retry all session; filtering just stays off
      return deviceMap;
    });
  }

  function countDevices(map) {
    var seen = {}, keys = Object.keys(map), i;
    for (i = 0; i < keys.length; i++) seen[map[keys[i]]] = true;
    return Object.keys(seen).length;
  }

  function mine(items) {
    if (!claimed || !deviceMap) return items;
    return items.filter(function (m) {
      var dev = deviceMap[m.ratingKey];
      return !dev || claimed[dev];
    });
  }

  /* ---------- the claim screen ---------- */

  function open(onSaved) {
    onClose = onSaved;
    UI.show('devices');
    idx = 0;
    elList.innerHTML = '<div class="device-row">Reading history…</div>';
    Promise.all([ensureHistory(), Plex.devices()]).then(function (res) {
      var map = res[0] || {}, named = res[1] || [];
      var names = {}, counts = {}, keys = Object.keys(map), i, id;
      for (i = 0; i < named.length; i++) names[named[i].id] = named[i].name;
      for (i = 0; i < keys.length; i++) {
        id = map[keys[i]];
        counts[id] = (counts[id] || 0) + 1;
      }
      list = Object.keys(counts).map(function (d) {
        return { id: d, name: names[d] || ('device ' + d), count: counts[d],
                 mine: claimed ? !!claimed[d] : true };
      }).sort(function (a, b) { return b.count - a.count; });
      render();
    });
  }

  function render() {
    if (!list.length) {
      elList.innerHTML =
        '<div class="device-row">No device history available on this server.</div>';
      return;
    }
    var html = '', i, d;
    for (i = 0; i < list.length; i++) {
      d = list[i];
      html += '<div class="device-row' + (i === idx ? ' on' : '') + '">' +
              (d.mine ? '[x] ' : '[ ] ') + UI.escapeHtml(d.name) +
              ' <span class="device-count">' + d.count + ' items</span></div>';
    }
    elList.innerHTML = html;
  }

  function save() {
    var changed = false;
    if (list.length) {
      var map = {}, i;
      for (i = 0; i < list.length; i++) if (list[i].mine) map[list[i].id] = true;
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
