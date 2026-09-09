/* One XHR, for every client that talks to something.

   Plex, TMDB and YouTube each grew their own copy of the same forty lines —
   open, timeout, status check, parse, three error paths — and the copies had
   started to drift. They differ in three things only, and those are the
   options: the headers to send, the name to put in an error, and whether a
   body that is not JSON is an answer or a failure.

   No fetch(): Chromium 53 has it, but not with the timeout this needs, and a
   request to a server on the other side of the country that never returns is
   worse than one that fails. */
var Http = (function () {
  'use strict';

  /* Encode an object as a query string, dropping anything null or undefined —
     Plex reads an empty parameter as a value, not as an omission. */
  function qs(params) {
    const keys = Object.keys(params);
    const parts = [];
    for (let i = 0; i < keys.length; i++) {
      const v = params[keys[i]];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(v));
    }
    return parts.join('&');
  }

  /* opts: method, headers, timeout, body, label (what an error calls this),
     text (resolve a non-JSON body instead of rejecting), explain (add the
     server's own reason to a failure). */
  function request(url, opts) {
    opts = opts || {};
    const label = opts.label || url;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(opts.method || 'GET', url, true);
      xhr.timeout = opts.timeout || 15000;
      const h = opts.headers || {};
      const keys = Object.keys(h);
      for (let i = 0; i < keys.length; i++) xhr.setRequestHeader(keys[i], h[keys[i]]);
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(label + ' -> ' + xhr.status + (opts.explain ? opts.explain(xhr) : '')));
          return;
        }
        if (!xhr.responseText) { resolve(null); return; }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) {
          if (opts.text) resolve(xhr.responseText);
          else reject(new Error(label + ' bad json'));
        }
      };
      xhr.ontimeout = () => { reject(new Error(label + ' timeout')); };
      xhr.onerror = () => { reject(new Error(label + ' network')); };
      xhr.send(opts.body || null);
    });
  }

  return { qs: qs, request: request };
})();
