/* IndexedDB key/value cache. One store, string keys:
     sections            -> [{key,title,type}]
     items:<sectionKey>  -> [item, ...]
     meta:<ratingKey>    -> full /library/metadata payload
   ponytail: one object store, whole-section blobs. A section is a few hundred
   KB; splitting into pages buys nothing until libraries get much bigger. */
var Store = (function () {
  'use strict';

  var NAME = 'reflex', STORE = 'kv', dbp = null;
  var mem = {};          // fallback if IndexedDB is unavailable or blocked

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      var req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var out = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(out.result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function get(key) {
    return tx('readonly', function (s) { return s.get(key); })
      .catch(function () { return mem[key]; });
  }

  function put(key, value) {
    mem[key] = value;
    return tx('readwrite', function (s) { return s.put(value, key); })
      .catch(function () { return null; });
  }

  return { get: get, put: put };
})();
