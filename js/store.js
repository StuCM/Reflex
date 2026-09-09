/* IndexedDB key/value cache. One store, string keys:
     sections            -> [{key,title,type}]
     items:<sectionKey>  -> [item, ...]
     meta:<ratingKey>    -> full /library/metadata payload
   ponytail: one object store, whole-section blobs. A section is a few hundred
   KB; splitting into pages buys nothing until libraries get much bigger. */
var Store = (function () {
  'use strict';

  let NAME = 'reflex', STORE = 'kv', dbp = null;
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
    return open().then(db => {
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const out = fn(t.objectStore(STORE));
        t.oncomplete = () => { resolve(out.result); };
        t.onerror = () => { reject(t.error); };
      });
    });
  }

  function get(key) {
    return tx('readonly', s => s.get(key))
      .catch(() => mem[key]);
  }

  function put(key, value) {
    mem[key] = value;
    return tx('readwrite', s => s.put(value, key))
      .catch(() => null);
  }

  return { get: get, put: put };
})();
