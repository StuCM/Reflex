/* Runs every test/*.test.js in its own process. No framework, no dependencies —
   the tests are assertions about pure functions and they either throw or they
   do not.

     npm test */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(function (f) { return /\.test\.js$/.test(f); }).sort();

let failed = 0;
files.forEach(function (f) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (r.status === 0) {
    console.log('  ok    ' + out.split('\n').pop());
  } else {
    failed++;
    console.log('  FAIL  ' + f);
    console.log((r.stdout || '') + (r.stderr || '').split('\n').slice(0, 12).join('\n'));
  }
});

console.log('\n  ' + (files.length - failed) + '/' + files.length + ' test files passed\n');
process.exit(failed ? 1 : 0);
