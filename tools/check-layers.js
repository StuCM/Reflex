/* Are the layers still layers?

     npm run check

   The directories in src/ are only a shape until something enforces them, and
   a shape is what a screen file reaches past at 1am when it wants one more
   field off the server. This is that something.

   It used to also scan js/ for syntax newer than Chromium 53. That retired
   with the bundler: `build.target: chrome53` lowers syntax, `lib: ES2015` in
   tsconfig catches the ES built-ins, stylelint reads the same browserslist for
   CSS, and eslint's no-restricted-properties covers the DOM methods none of
   those can see. src/ uses `?.` and `??` deliberately.

   This is a text scan, not a parser: it catches what a file reaches *for*, not
   what it imports. Turning it into import lint is the last step-7 job — see
   docs/refactor-plan.md. dev/, test/ and tools/ are not scanned; they never
   reach the TV. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* Comment and string noise this scan should not trip over: a rule name quoted
   inside a comment is not a use of it. Crude, but it keeps the output honest. */
function stripNoise(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '')
    .replace(/\/\/.*$/, '');
}

const problems = [];

function scan(file, rules) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let inBlockComment = false;
  lines.forEach(function (raw, i) {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.lastIndexOf('/*');
    if (open >= 0 && line.indexOf('*/', open) < 0) {
      inBlockComment = true;
      line = line.slice(0, open);
    }
    line = stripNoise(line);
    rules.forEach(function (rule) {
      if (rule[0].test(line)) {
        problems.push(
          rel +
            ':' +
            (i + 1) +
            '  ' +
            rule[1] +
            '  (' +
            rule[2] +
            ')\n      ' +
            raw.trim().slice(0, 100),
        );
      }
    });
  });
}

function listFiles(dir, ext) {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push.apply(out, listFiles(full, ext));
    else if (path.extname(e.name) === ext) out.push(full);
  });
  return out.sort();
}

/* What each layer is allowed to touch. Without this the directories are a
   suggestion, and a suggestion is what a screen file reaches past at 1am when
   it wants one more field off the server.

   The rule is per layer, and it is about what a file may *reach for*, not what
   it may know: api/ is the only place an XHR is opened, data/ the only place
   the key/value store is addressed, and rules/ is the pure half — no DOM, no
   request, no cache — which is what makes it the half worth unit testing. */
const LAYER_RULES = {
  'src/rules': [
    [/\bdocument\./, 'the DOM in rules/', 'rules/ is pure: no DOM, no request, no cache'],
    [/\bXMLHttpRequest\b/, 'a request in rules/', 'rules/ is pure: call it from data/'],
    [/\bindexedDB\b/, 'the cache in rules/', 'rules/ is pure: read it in data/'],
  ],
  'src/api': [[/\bdocument\./, 'the DOM in api/', 'api/ speaks to servers, not to the screen']],
  'src/view': [
    [/\bXMLHttpRequest\b/, 'a raw request in view/', 'go through api/'],
    [/\bindexedDB\b/, 'the store in view/', 'go through data/cached'],
  ],
  'src/screen': [
    [/\bXMLHttpRequest\b/, 'a raw request in screen/', 'go through api/'],
    [/\bindexedDB\b/, 'the store in screen/', 'go through data/cached'],
  ],
  'src/core': [[/\bXMLHttpRequest\b/, 'a raw request in core/', 'go through api/']],
};

/* http.js is the one file whose whole job is the thing api/ owns. */
const LAYER_EXEMPT = { 'src/api/http.ts': 1, 'src/data/store.ts': 1 };

function layerOf(rel) {
  const parts = rel.split('/');
  return parts.length > 2 ? parts[0] + '/' + parts[1] : null;
}

const jsFiles = listFiles(path.join(ROOT, 'src'), '.ts');
jsFiles.forEach(function (f) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (LAYER_EXEMPT[rel]) return;
  const extra = LAYER_RULES[layerOf(rel)];
  if (extra) scan(f, extra);
});
if (problems.length) {
  console.log(
    '\n  ' + problems.length + ' layer problem' + (problems.length === 1 ? '' : 's') + ':\n',
  );
  problems.forEach(function (p) {
    console.log('  ' + p);
  });
  console.log('');
  process.exit(1);
}

console.log('  layers: ' + jsFiles.length + ' modules, nothing reaching past its own');
