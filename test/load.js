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

module.exports = function load(files) {
  const store = {};
  const ctx = {
    console: console,
    /* servers.js persists the server list and the preference. */
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    }
  };
  vm.createContext(ctx);
  files.forEach(function (f) {
    const file = path.join(__dirname, '..', 'js', f + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: f + '.js' });
  });
  return ctx;
};
