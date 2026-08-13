/* The servers we can reach, and which one a given item came from.

   The account has more than one server, and the same film is often on both.
   Nothing in the app may assume "the server" — every request is made against a
   named one, and every item the app holds is stamped with where it came from so
   that posters, decisions and playback all go back to the right place.

   A server here is: { id, name, base, token }. `id` is the machine identifier,
   which is stable; `base` is whichever of its addresses answered first. */
var Servers = (function () {
  'use strict';

  var list = [];

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
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* Items carry their origin as _server. Anything that lost the stamp is a bug
     upstream, but falling back to the first server beats throwing. */
  function of(item) {
    return (item && get(item._server)) || list[0] || null;
  }

  function stamp(items, server) {
    var i;
    for (i = 0; i < items.length; i++) if (items[i]) items[i]._server = server.id;
    return items;
  }

  function set(found) {
    list = found;
    ls('servers', JSON.stringify(list.map(function (sv) {
      return { id: sv.id, name: sv.name, base: sv.base, token: sv.token };
    })));
  }

  function load() {
    var raw = ls('servers');
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

  var preferredId = null;

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
    var at = 0, i, cur = preferred();
    for (i = 0; i < list.length; i++) if (list[i].id === cur) at = i;
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
