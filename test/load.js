/* Loads app modules into one sandbox so the pure ones can be tested together.

   The app has no bundler and no module system — each file is a global, and
   index.html's script order is the dependency graph. That is fine in a browser
   and awkward in Node, so this runs the files in a shared context and hands
   back the globals they defined.

   Only for modules that touch neither the DOM nor the network. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* js/ is layered, and a test names a module rather than a path — 'media', not
   'rules/media'. One scan maps the names to where they live, so moving a file
   between layers does not touch a single test. */
const LAYERS = ['core', 'api', 'data', 'rules', 'view', 'screen'];
function locate(name) {
  const flat = path.join(__dirname, '..', 'js', name + '.js');
  if (fs.existsSync(flat)) return flat;
  for (let i = 0; i < LAYERS.length; i++) {
    const inLayer = path.join(__dirname, '..', 'js', LAYERS[i], name + '.js');
    if (fs.existsSync(inLayer)) return inLayer;
  }
  throw new Error('no such module in js/: ' + name);
}

module.exports = function load(files) {
  const store = {};
  const ctx = {
    console: console,
    /* js/panel.js asks the video element what it can play. In Node there is no
       panel, so it answers nothing and Panel falls back to its baseline —
       which is exactly the set the tests are written against. */
    document: {
      getElementById: function () {
        return { canPlayType: function () { return ''; } };
      }
    },
    /* servers.js persists the server list and the preference. */
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  };
  vm.createContext(ctx);
  files.forEach(function (f) {
    vm.runInContext(fs.readFileSync(locate(f), 'utf8'), ctx, { filename: f + '.js' });
  });
  return ctx;
};
